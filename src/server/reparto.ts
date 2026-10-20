import { sql } from "drizzle-orm";
import { z } from "zod";
import { can, moduleEnabled } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/domain/audit";
import { createDocument } from "@/lib/domain/documents";
import { formatMeasure, todayIso } from "@/lib/format";
import { kmAllowed } from "@/lib/guards";
import { CURRENT_FUEL_TAXES_SQL, fuelSaleDraft, withinCapacity, type FuelTax } from "@/lib/estacion/calc";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

export async function reparto(method: string, path: string[], req: Request): Promise<Response> {
  const [, area, action] = path;
  if (method === "GET" && !area) return board();
  if (method === "GET" && area === "clientes") return repartoClients();
  if (method === "POST" && area === "camion" && !action) return createTruck(req);
  if (method === "POST" && area === "viaje" && !action) return openTrip(req);
  if (method === "POST" && area === "viaje" && action === "carga") return loadTrip(req);
  if (method === "POST" && area === "viaje" && action === "entrega") return dropTrip(req);
  if (method === "POST" && area === "viaje" && action === "retorno") return returnTrip(req);
  if (method === "POST" && area === "viaje" && action === "gasto") return expense(req);
  if (method === "POST" && area === "viaje" && action === "cerrar") return closeTrip(req);
  if (method === "POST" && area === "viaje" && action === "devolver") return returnLeftover(req);
  if (method === "POST" && area === "comprobantes") return billEvents(req);
  if (method === "GET" && area === "informes") return report(new URL(req.url));
  throw new HttpError(404, "No existe esa ruta");
}

async function board() {
  const auth = await requirePermission("reparto", "ver");
  const ownOnly = !can(auth.permissions, "reparto", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const trucks = await tx.execute<{ id: string; plate: string; name: string }>(sql`
      select id::text, plate, name from fuel_trucks
      where company_id = ${auth.company.companyId} and active
        and (${ownOnly} = false or id in (select truck_id from fuel_trips where company_id = ${auth.company.companyId} and driver_user_id = ${auth.user.id}))
      order by name
    `);
    const compartments = await tx.execute<{ id: string; truck_id: string; name: string; product_id: string; product_name: string; capacity: string; quantity: string }>(sql`
      select c.id::text, c.truck_id::text, c.name, c.product_id::text, p.name as product_name, c.capacity::text, c.quantity::text
      from fuel_compartments c join fuel_products p on p.id = c.product_id
      where c.company_id = ${auth.company.companyId}
        and (${ownOnly} = false or c.truck_id in (select truck_id from fuel_trips where company_id = ${auth.company.companyId} and driver_user_id = ${auth.user.id}))
      order by c.name
    `);
    const trips = await tx.execute<{ id: string; truck_id: string; driver_name: string; driver_user_id: string | null; status: string; km_start: string | null; km_end: string | null; opened_at: string }>(sql`
      select id::text, truck_id::text, driver_name, driver_user_id::text, status, km_start::text, km_end::text, opened_at::text
      from fuel_trips
      where company_id = ${auth.company.companyId}
        and (${ownOnly} = false or driver_user_id = ${auth.user.id})
      order by opened_at desc
      limit 12
    `);
    const events = trips.length
      ? await tx.execute<{ id: string; trip_id: string; kind: string; liters: string | null; amount_cents: string | null; note: string | null; document_id: string | null; customer_id: string | null }>(sql`
          select id::text, trip_id::text, kind, liters::text, amount_cents::text, note, document_id::text, customer_id::text
          from fuel_trip_events
          where company_id = ${auth.company.companyId}
            and trip_id in (${sql.join(trips.map((trip) => sql`${trip.id}::uuid`), sql`, `)})
          order by occurred_at desc
          limit 80
        `)
      : [];
    const summary = await tx.execute<{ truck: string; driver: string; liters: string; expenses: string; shrinkage: string }>(sql`
      select tr.plate as truck, t.driver_name as driver,
             coalesce(sum(e.liters) filter (where e.kind = 'entrega'), 0)::text as liters,
             coalesce(sum(e.amount_cents) filter (where e.kind = 'gasto'), 0)::text as expenses,
             coalesce(sum(e.liters) filter (where e.kind = 'merma'), 0)::text as shrinkage
      from fuel_trips t
      join fuel_trucks tr on tr.id = t.truck_id
      left join fuel_trip_events e on e.trip_id = t.id
      where t.company_id = ${auth.company.companyId}
        and (${ownOnly} = false or t.driver_user_id = ${auth.user.id})
      group by tr.plate, t.driver_name
      order by tr.plate, t.driver_name
    `);
    const tanks = await tx.execute<{ id: string; name: string; capacity: string }>(sql`select id::text, name, capacity::text from fuel_tanks where company_id = ${auth.company.companyId} order by name`);
    const customers = await tx.execute<{ id: string; name: string }>(sql`select id::text, name from customers where company_id = ${auth.company.companyId} and active order by name limit 100`);
    return ok({
      canEdit: can(auth.permissions, "reparto", "editar"),
      canCreate: can(auth.permissions, "reparto", "crear"),
      trucks,
      compartments,
      trips,
      events,
      tanks,
      customers,
      summary,
    });
  });
}

async function repartoClients() {
  const auth = await requirePermission("reparto", "ver");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const customers = await tx.execute<{ id: string; name: string }>(sql`
      select id::text, name from customers
      where company_id = ${auth.company.companyId} and active
      order by name
      limit 100
    `);
    return ok({ customers });
  });
}

async function createTruck(req: Request) {
  const auth = await requirePermission("reparto", "editar");
  const body = await readBody(req, z.object({
    plate: z.string().trim().min(5).max(10),
    name: z.string().trim().min(1).max(80),
    compartments: z.array(z.object({
      name: z.string().trim().min(1).max(40),
      productId: z.string().uuid(),
      capacity: z.number().positive(),
    })).min(1).max(6),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const [truck] = await tx.execute<{ id: string }>(sql`
      insert into fuel_trucks (company_id, plate, name) values (${auth.company.companyId}, ${body.plate.toUpperCase()}, ${body.name}) returning id::text
    `);
    for (const compartment of body.compartments) {
      await tx.execute(sql`
        insert into fuel_compartments (company_id, truck_id, product_id, name, capacity)
        values (${auth.company.companyId}, ${truck.id}, ${compartment.productId}, ${compartment.name}, ${compartment.capacity})
      `);
    }
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.camion", entity: "camion", entityId: truck.id, summary: `Alta del camión ${body.plate.toUpperCase()}` });
    return ok({ id: truck.id });
  });
}

async function openTrip(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({
    truckId: z.string().uuid(),
    driverUserId: z.string().uuid().optional(),
    driverName: z.string().trim().min(1).max(80).optional(),
    kmStart: z.number().nonnegative().optional(),
  }));
  const forOther = Boolean(body.driverUserId && body.driverUserId !== auth.user.id);
  if (forOther && !can(auth.permissions, "reparto", "editar")) throw new HttpError(403, "Solo el encargado asigna el viaje a otro chofer");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    if (!can(auth.permissions, "reparto", "editar")) {
      const mine = await tx.execute<{ ok: number }>(sql`
        select 1 as ok from fuel_trips where company_id = ${auth.company.companyId} and truck_id = ${body.truckId} and driver_user_id = ${auth.user.id} limit 1
      `);
      if (!mine[0]) throw new HttpError(403, "Ese camión no está en tus viajes");
    }
    const driverId = forOther ? body.driverUserId! : auth.user.id;
    const named = await tx.execute<{ name: string }>(sql`select name from users where id = ${driverId}`);
    const previous = await tx.execute<{ km_end: string }>(sql`
      select km_end::text from fuel_trips
      where company_id = ${auth.company.companyId} and truck_id = ${body.truckId} and status = 'cerrado' and km_end is not null
      order by closed_at desc limit 1
    `);
    const opening = body.kmStart ?? (previous[0] ? Number(previous[0].km_end) : null);
    if (opening != null && previous[0] && opening < Number(previous[0].km_end)) {
      throw new HttpError(409, "El kilometraje de salida no puede ser menor que el último cierre de ese camión");
    }
    const [trip] = await tx.execute<{ id: string }>(sql`
      insert into fuel_trips (company_id, truck_id, driver_user_id, driver_name, km_start)
      values (${auth.company.companyId}, ${body.truckId}, ${driverId}, ${body.driverName || named[0]?.name || auth.user.name}, ${opening})
      returning id::text
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.viaje", entity: "viaje", entityId: trip.id, summary: "Abrió una hoja de ruta" });
    return ok({ id: trip.id });
  });
}

async function ownTrip(tx: Tx, auth: { user: { id: string }; permissions: Set<string>; company: { companyId: string } }, tripId: string) {
  const rows = await tx.execute<{ driver_user_id: string | null; status: string; truck_id: string }>(sql`
    select driver_user_id::text, status, truck_id::text from fuel_trips where id = ${tripId} and company_id = ${auth.company.companyId}
  `);
  const trip = rows[0];
  if (!trip) throw new HttpError(404, "No encontramos el viaje");
  if (trip.status !== "abierto") throw new HttpError(400, "Ese viaje ya está cerrado");
  if (!can(auth.permissions, "reparto", "editar") && trip.driver_user_id !== auth.user.id) throw new HttpError(403, "Solo podés cargar tu hoja de ruta");
  return trip;
}

async function loadTrip(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({ tripId: z.string().uuid(), compartmentId: z.string().uuid(), tankId: z.string().uuid(), liters: z.number().positive() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownTrip(tx, auth, body.tripId);
    const compartment = await tx.execute<{ capacity: string; quantity: string; product_id: string; tank_product: string; tank_capacity: string; tank_name: string }>(sql`
      select c.capacity::text, c.quantity::text, c.product_id::text, t.product_id::text as tank_product, t.capacity::text as tank_capacity, t.name as tank_name
      from fuel_compartments c, fuel_tanks t
      where c.id = ${body.compartmentId} and t.id = ${body.tankId} and c.company_id = ${auth.company.companyId}
    `);
    const row = compartment[0];
    if (!row) throw new HttpError(400, "El compartimento o el tanque no son de esta estación");
    if (row.product_id !== row.tank_product) throw new HttpError(400, "El compartimento y el tanque tienen que ser el mismo producto");
    if (!withinCapacity(Number(row.capacity), Number(row.quantity) + body.liters)) throw new HttpError(409, "El compartimento no tiene esa capacidad");
    const volume = await tx.execute<{ volume: string }>(sql`
      select (
        coalesce((select liters from fuel_sticks where tank_id = ${body.tankId} order by measured_at desc limit 1), 0)
        + coalesce((select sum(liters) from fuel_deliveries where tank_id = ${body.tankId} and delivered_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${body.tankId}), '-infinity')), 0)
        - coalesce((select sum(r.liters) from fuel_readings r join fuel_shifts s on s.id = r.shift_id join fuel_nozzles n on n.id = r.nozzle_id where n.tank_id = ${body.tankId} and s.status = 'cerrado' and s.opened_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${body.tankId}), '-infinity')), 0)
        - coalesce((select sum(case when kind = 'carga' then liters else -liters end) from fuel_trip_events where tank_id = ${body.tankId} and kind in ('carga','retorno') and occurred_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${body.tankId}), '-infinity')), 0)
      )::text as volume
    `);
    if (Number(volume[0]?.volume ?? 0) + 0.0005 < body.liters) throw new HttpError(409, `En ${row.tank_name} no alcanza el combustible`);
    await tx.execute(sql`update fuel_compartments set quantity = quantity + ${body.liters} where id = ${body.compartmentId}`);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, tank_id, compartment_id, liters)
      values (${auth.company.companyId}, ${body.tripId}, 'carga', ${body.tankId}, ${body.compartmentId}, ${body.liters})
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.carga", entity: "viaje", entityId: body.tripId, summary: `Cargó ${body.liters} desde ${row.tank_name}` });
    return ok({ saved: true });
  });
}

async function dropTrip(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({
    tripId: z.string().uuid(),
    compartmentId: z.string().uuid(),
    customerId: z.string().uuid(),
    liters: z.number().positive(),
    document: z.enum(["remito", "factura"]).default("remito"),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownTrip(tx, auth, body.tripId);
    const compartment = await tx.execute<{ quantity: string; product_name: string }>(sql`
      select c.quantity::text, p.name as product_name from fuel_compartments c join fuel_products p on p.id = c.product_id
      where c.id = ${body.compartmentId} and c.company_id = ${auth.company.companyId}
    `);
    const row = compartment[0];
    if (!row) throw new HttpError(400, "No encontramos el compartimento");
    if (Number(row.quantity) + 0.0005 < body.liters) throw new HttpError(409, "El camión no tiene esos litros");
    const kind = body.document === "factura" ? "venta" : "remito";
    const moduleKey = kind === "venta" ? "ventas" : "remitos";
    const code = body.document === "factura" ? "FAC" : "REM";
    let documentId: string | null = null;
    if (can(auth.permissions, moduleKey, "crear") && moduleEnabled(auth.company.enabledModules, moduleKey)) {
      const [dtype] = await tx.execute<{ id: string }>(sql`
        select id::text from document_types where company_id = ${auth.company.companyId} and code = ${code} and kind = ${kind} and active limit 1
      `);
      const priced = await tx.execute<{ cents: string; iva: number; taxes: FuelTax[] | null }>(sql`
        select pr.cents_per_unit::text as cents, p.iva_rate_bps as iva,
          ${sql.raw(CURRENT_FUEL_TAXES_SQL)} as taxes
        from fuel_compartments c
        join fuel_products p on p.id = c.product_id
        join fuel_prices pr on pr.product_id = p.id
        where c.id = ${body.compartmentId}
        order by pr.valid_from desc
        limit 1
      `);
      const price = priced[0];
      if (dtype && price) {
        const draft = fuelSaleDraft({
          description: row.product_name,
          liters: body.liters,
          pumpPriceCents: Number(price.cents),
          ivaRateBps: price.iva,
          taxes: price.taxes ?? [],
          invoice: kind === "venta",
        });
        const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
          kind,
          documentTypeId: dtype.id,
          partyId: body.customerId,
          issuedOn: todayIso(),
          paymentMethod: "cuenta_corriente",
          otherTaxesCents: draft.otherTaxesCents,
          perceptions: [],
          lines: [draft.line],
        });
        documentId = created.id;
      }
    }
    await tx.execute(sql`update fuel_compartments set quantity = quantity - ${body.liters} where id = ${body.compartmentId}`);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, compartment_id, customer_id, document_id, liters, note)
      values (${auth.company.companyId}, ${body.tripId}, 'entrega', ${body.compartmentId}, ${body.customerId}, ${documentId}, ${body.liters}, ${documentId ? body.document : body.document + " pendiente"})
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.entrega", entity: "viaje", entityId: body.tripId, summary: `Entregó ${body.liters} de ${row.product_name} (${body.document})` });
    return ok({ saved: true, documentId });
  });
}

async function returnTrip(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({ tripId: z.string().uuid(), compartmentId: z.string().uuid(), tankId: z.string().uuid(), liters: z.number().positive() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownTrip(tx, auth, body.tripId);
    const compartment = await tx.execute<{ quantity: string; product_id: string }>(sql`
      select quantity::text, product_id::text from fuel_compartments where id = ${body.compartmentId} and company_id = ${auth.company.companyId}
    `);
    const row = compartment[0];
    if (!row) throw new HttpError(400, "No encontramos el compartimento");
    if (Number(row.quantity) + 0.0005 < body.liters) throw new HttpError(409, "No hay tanto sobrante en el camión");
    const tank = await tx.execute<{ product_id: string; capacity: string; name: string }>(sql`select product_id::text, capacity::text, name from fuel_tanks where id = ${body.tankId}`);
    if (!tank[0] || tank[0].product_id !== row.product_id) throw new HttpError(400, "El retorno tiene que ir al tanque del mismo producto");
    if (!withinCapacity(Number(tank[0].capacity), body.liters)) throw new HttpError(409, `${tank[0].name} no admite ese retorno`);
    await tx.execute(sql`update fuel_compartments set quantity = quantity - ${body.liters} where id = ${body.compartmentId}`);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, tank_id, compartment_id, liters)
      values (${auth.company.companyId}, ${body.tripId}, 'retorno', ${body.tankId}, ${body.compartmentId}, ${body.liters})
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.retorno", entity: "tanque", entityId: body.tankId, summary: `Devolvió ${body.liters} a ${tank[0].name}` });
    return ok({ saved: true });
  });
}

async function expense(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({ tripId: z.string().uuid(), amountCents: z.number().int().positive(), note: z.string().trim().min(1).max(120) }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownTrip(tx, auth, body.tripId);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, amount_cents, note)
      values (${auth.company.companyId}, ${body.tripId}, 'gasto', ${body.amountCents}, ${body.note})
    `);
    return ok({ saved: true });
  });
}

async function returnLeftover(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({ tripId: z.string().uuid() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const trip = await ownTrip(tx, auth, body.tripId);
    const left = await tx.execute<{ quantity: string }>(sql`
      select c.quantity::text from fuel_compartments c where c.truck_id = ${trip.truck_id} and c.quantity > 0
    `);
    if (!left.length) throw new HttpError(400, "El camión no tiene litros para devolver");
    for (const row of left) {
      const tank = await tx.execute<{ id: string }>(sql`
        select t.id::text from fuel_tanks t
        join fuel_compartments c on c.product_id = t.product_id
        where c.truck_id = ${trip.truck_id} and c.quantity > 0 and t.company_id = ${auth.company.companyId}
        limit 1
      `);
      if (!tank[0]) throw new HttpError(400, "No hay un tanque del mismo producto para devolver");
      await tx.execute(sql`
        insert into fuel_trip_events (company_id, trip_id, kind, tank_id, liters, note)
        values (${auth.company.companyId}, ${body.tripId}, 'retorno', ${tank[0].id}::uuid, ${Number(row.quantity)}, 'Devolución al tanque')
      `);
    }
    await tx.execute(sql`update fuel_compartments set quantity = 0 where truck_id = ${trip.truck_id}`);
    return ok({ returned: true });
  });
}

async function closeTrip(req: Request) {
  const auth = await requirePermission("reparto", "crear");
  const body = await readBody(req, z.object({
    tripId: z.string().uuid(),
    kmEnd: z.number().nonnegative().optional(),
    disposition: z.enum(["merma", "devolucion"]).optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const trip = await ownTrip(tx, auth, body.tripId);
    const left = await tx.execute<{ quantity: string; name: string }>(sql`
      select c.quantity::text, c.name from fuel_compartments c where c.truck_id = ${trip.truck_id} and c.quantity > 0
    `);
    const shrinkage = left.reduce((sum, row) => sum + Number(row.quantity), 0);
    if (shrinkage > 0.0005 && !body.disposition) {
      throw new HttpError(409, `Quedan ${formatMeasure(shrinkage, "litro")} en el camión. Elegí devolución al tanque o merma.`);
    }
    if (body.kmEnd != null) {
      const start = await tx.execute<{ km_start: string | null }>(sql`select km_start::text from fuel_trips where id = ${body.tripId}`);
      const blocked = kmAllowed(start[0]?.km_start == null ? null : Number(start[0].km_start), body.kmEnd);
      if (blocked) throw new HttpError(409, blocked);
    }
    await tx.execute(sql`
      update fuel_trips set status = 'cerrado', closed_at = now(), km_end = ${body.kmEnd ?? null}
      where id = ${body.tripId}
    `);
    if (shrinkage > 0 && body.disposition === "devolucion") {
      for (const row of left) {
        const tank = await tx.execute<{ id: string; name: string }>(sql`
          select t.id::text, t.name from fuel_tanks t
          join fuel_compartments c on c.product_id = t.product_id
          where c.truck_id = ${trip.truck_id} and c.quantity > 0 and t.company_id = ${auth.company.companyId}
          limit 1
        `);
        if (!tank[0]) throw new HttpError(400, "No hay un tanque del mismo producto para devolver");
        await tx.execute(sql`
          insert into fuel_trip_events (company_id, trip_id, kind, tank_id, liters, note)
          values (${auth.company.companyId}, ${body.tripId}, 'retorno', ${tank[0].id}::uuid, ${Number(row.quantity)}, 'Devolución al cerrar')
        `);
      }
      await tx.execute(sql`update fuel_compartments set quantity = 0 where truck_id = ${trip.truck_id}`);
    } else if (shrinkage > 0) {
      await tx.execute(sql`update fuel_compartments set quantity = 0 where truck_id = ${trip.truck_id}`);
      await tx.execute(sql`
        insert into fuel_trip_events (company_id, trip_id, kind, liters, note)
        values (${auth.company.companyId}, ${body.tripId}, 'merma', ${shrinkage}, 'Sobrante no devuelto al cerrar')
      `);
    }
    const summary = shrinkage <= 0 ? "Cerró el viaje" : body.disposition === "devolucion" ? `Devolvió ${shrinkage} litros al tanque` : `Cerró el viaje con merma de ${shrinkage}`;
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "reparto.cierre", entity: "viaje", entityId: body.tripId, summary });
    return ok({ shrinkage });
  });
}

async function billEvents(req: Request) {
  const body = await readBody(req, z.object({
    eventIds: z.array(z.string().uuid()).min(1).max(40),
    document: z.enum(["remito", "factura"]),
  }));
  const kind = body.document === "factura" ? "venta" : "remito";
  const moduleKey = kind === "venta" ? "ventas" : "remitos";
  const auth = await requirePermission(body.document === "remito" ? "reparto" : moduleKey, body.document === "remito" ? "crear" : "crear");
  if (body.document === "factura" && (!can(auth.permissions, moduleKey, "crear") || !moduleEnabled(auth.company.enabledModules, moduleKey))) {
    throw new HttpError(403, "No tenés permiso para emitir ese comprobante");
  }
  if (body.document === "remito" && !moduleEnabled(auth.company.enabledModules, "remitos")) {
    throw new HttpError(403, "No tenés permiso para emitir ese comprobante");
  }
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const ids = sql.join(body.eventIds.map((id) => sql`${id}::uuid`), sql`, `);
    type DeliveryRow = { id: string; customer_id: string; liters: string; product_name: string; code: string; cents: string; iva: number; taxes: FuelTax[] | null };
    const rows = await tx.execute<DeliveryRow>(sql`
      select e.id::text, e.customer_id::text, e.liters::text, p.name as product_name, p.code, pr.cents_per_unit::text as cents, p.iva_rate_bps as iva,
        ${sql.raw(CURRENT_FUEL_TAXES_SQL)} as taxes
      from fuel_trip_events e
      join fuel_compartments c on c.id = e.compartment_id
      join fuel_products p on p.id = c.product_id
      join fuel_prices pr on pr.product_id = p.id
        and pr.valid_from = (select max(valid_from) from fuel_prices where product_id = p.id and valid_from <= now())
      where e.company_id = ${auth.company.companyId} and e.kind = 'entrega' and e.document_id is null and e.id in (${ids})
    `);
    if (!rows.length) throw new HttpError(400, "Esas entregas ya tienen comprobante o no son de un cliente");
    const preferred = body.document === "factura" ? "FAC" : "REM";
    const [dtype] = await tx.execute<{ id: string }>(sql`
      select id::text from document_types
      where company_id = ${auth.company.companyId} and kind = ${kind} and active
      order by (code = ${preferred}) desc, code
      limit 1
    `);
    if (!dtype) throw new HttpError(400, "Definí un comprobante de ese tipo, no hace falta que el código sea REM");
    const byCustomer = new Map<string, DeliveryRow[]>();
    for (const row of rows) {
      const bucket = byCustomer.get(row.customer_id) ?? [];
      bucket.push(row);
      byCustomer.set(row.customer_id, bucket);
    }
    const documents: string[] = [];
    for (const [customerId, lines] of byCustomer) {
      let other = 0;
      const draft = lines.map((line) => {
        const sale = fuelSaleDraft({
          description: line.product_name,
          sku: line.code,
          liters: Number(line.liters),
          pumpPriceCents: Number(line.cents),
          ivaRateBps: line.iva,
          taxes: line.taxes ?? [],
          invoice: true,
        });
        other += sale.otherTaxesCents;
        return sale.line;
      });
      const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
        kind, documentTypeId: dtype.id, partyId: customerId, issuedOn: todayIso(), paymentMethod: "cuenta_corriente", otherTaxesCents: other, perceptions: [], lines: draft,
      });
      documents.push(created.id);
      const lineIds = sql.join(lines.map((line) => sql`${line.id}::uuid`), sql`, `);
      await tx.execute(sql`update fuel_trip_events set document_id = ${created.id}::uuid, note = ${body.document} where id in (${lineIds})`);
    }
    return ok({ documents });
  });
}

async function report(url: URL) {
  const auth = await requirePermission("reparto", "ver");
  const from = url.searchParams.get("desde") ?? todayIso(new Date(Date.now() - 30 * 864e5));
  const to = url.searchParams.get("hasta") ?? todayIso();
  const ownOnly = !can(auth.permissions, "reparto", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const rows = await tx.execute<{ truck: string; driver: string; liters: string; expenses: string; shrinkage: string }>(sql`
      select tr.plate as truck, t.driver_name as driver,
             coalesce(sum(e.liters) filter (where e.kind = 'entrega'), 0)::text as liters,
             coalesce(sum(e.amount_cents) filter (where e.kind = 'gasto'), 0)::text as expenses,
             coalesce(sum(e.liters) filter (where e.kind = 'merma'), 0)::text as shrinkage
      from fuel_trips t
      join fuel_trucks tr on tr.id = t.truck_id
      left join fuel_trip_events e on e.trip_id = t.id
      where t.company_id = ${auth.company.companyId}
        and (
          t.status = 'abierto'
          or (coalesce(t.closed_at, t.opened_at) at time zone 'America/Argentina/Buenos_Aires')::date between ${from}::date and ${to}::date
        )
        and (${ownOnly} = false or t.driver_user_id = ${auth.user.id})
      group by tr.plate, t.driver_name
      order by tr.plate, t.driver_name
    `);
    return ok({ from, to, rows });
  });
}
