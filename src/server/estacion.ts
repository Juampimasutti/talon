import { sql } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/domain/audit";
import { isTaxCondition, priceModeForLetter, resolveLetter } from "@/lib/fiscal/letter";
import { litersSold, priceAt, reconcileTank, shiftGap, splitPumpSale, windowLiters, withinCapacity, type FuelTax } from "@/lib/estacion/calc";
import { cajaDifferenceText, formatMeasure, todayIso } from "@/lib/format";
import { normalizePlate } from "@/lib/guards";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";
import { equipos } from "@/server/equipos";

export async function estacion(method: string, path: string[], req: Request): Promise<Response> {
  const [, area, action] = path;
  if (method === "GET" && !area) return playa();
  if (method === "POST" && area === "turno" && !action) return openShift(req);
  if (method === "POST" && area === "turno" && action === "aforadores") return saveReadings(req);
  if (method === "POST" && area === "turno" && action === "shop") return addShop(req);
  if (method === "POST" && area === "turno" && action === "cerrar") return closeShift(req);
  if (method === "GET" && area === "tanques") return tanks();
  if (method === "POST" && area === "tanques" && action === "medicion") return stick(req);
  if (method === "POST" && area === "tanques" && action === "descarga") return delivery(req);
  if (method === "GET" && area === "precios") return prices();
  if (method === "POST" && area === "precios") return setPrice(req);
  if (method === "GET" && area === "flota-clientes") return fleetClients();
  if (method === "GET" && area === "flota") return fleet(new URL(req.url));
  if (method === "POST" && area === "flota" && action === "vehiculo") return addVehicle(req);
  if (method === "POST" && area === "flota" && action === "chofer") return addDriver(req);
  if (method === "POST" && area === "flota" && action === "vale") return addVoucher(req);
  if (method === "POST" && area === "flota" && action === "facturar") return billFleet(req);
  if (method === "GET" && area === "informes") return report(new URL(req.url));
  if (area === "equipos") return equipos(method, path.slice(2), req);
  throw new HttpError(404, "No existe esa ruta");
}

async function playa() {
  const auth = await requirePermission("estacion", "ver");
  const ownOnly = !can(auth.permissions, "estacion", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const products = await productBoard(tx, auth.company.companyId);
    const nozzles = await tx.execute<{
      id: string; number: number; pump_name: string; product_id: string; product_name: string; tank_id: string; tank_name: string; last_closing: string | null;
    }>(sql`
      select n.id::text, n.number, pu.name as pump_name, n.product_id::text, fp.name as product_name,
             n.tank_id::text, t.name as tank_name,
             coalesce(
               (select mr.reading::text from fuel_meter_resets mr
                 where mr.nozzle_id = n.id
                   and mr.reset_at >= coalesce((select s.opened_at from fuel_readings r join fuel_shifts s on s.id = r.shift_id where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1), '-infinity'::timestamptz)
                 order by mr.reset_at desc limit 1),
               (select r.closing::text from fuel_readings r
                  join fuel_shifts s on s.id = r.shift_id
                 where r.nozzle_id = n.id and r.closing is not null
                 order by s.opened_at desc limit 1)
             ) as last_closing
      from fuel_nozzles n
      join fuel_pumps pu on pu.id = n.pump_id
      join fuel_products fp on fp.id = n.product_id
      join fuel_tanks t on t.id = n.tank_id
      where n.company_id = ${auth.company.companyId} and pu.active and t.active
      order by pu.name, n.number
    `);
    const shifts = await tx.execute<{ id: string; attendant_id: string | null; attendant_name: string; opened_at: string; closed_at: string | null; status: string; invoiced_cents: string; fuel_cents: string; shop_cents: string; collected_cents: string }>(sql`
      select s.id::text, s.attendant_id::text, s.attendant_name, s.opened_at::text, s.closed_at::text, s.status, s.invoiced_cents::text,
        coalesce((select sum(r.amount_cents) from fuel_readings r where r.shift_id = s.id), 0)::text as fuel_cents,
        coalesce((select sum(sh.amount_cents) from fuel_shop_lines sh where sh.shift_id = s.id), 0)::text as shop_cents,
        coalesce((select sum(p.amount_cents) from fuel_payments p where p.shift_id = s.id), 0)::text as collected_cents
      from fuel_shifts s
      where s.company_id = ${auth.company.companyId}
        and (${ownOnly} = false or s.attendant_id = ${auth.user.id})
      order by s.opened_at desc
      limit 12
    `);
    const open = ownOnly
      ? shifts.find((shift) => shift.status === "abierto" && shift.attendant_id === auth.user.id) ?? null
      : shifts.find((shift) => shift.status === "abierto") ?? null;
    const detail = open ? await shiftDetail(tx, open.id) : { readings: [], payments: [], shop: [] };
    const attendants = can(auth.permissions, "estacion", "editar")
      ? await tx.execute<{ id: string; name: string }>(sql`
          select u.id::text, u.name
          from memberships m
          join users u on u.id = m.user_id
          join roles r on r.id = m.role_id
          where m.company_id = ${auth.company.companyId} and m.active and r.key in ('playero', 'encargado')
          order by u.name
        `)
      : [];
    const articles = await tx.execute<{ id: string; sku: string; name: string; price_cents: string | null; tracks_stock: boolean }>(sql`
      select p.id::text, p.sku, p.name, p.tracks_stock,
             (select pp.price_cents::text from product_prices pp
               join price_lists l on l.id = pp.price_list_id and l.is_default
              where pp.product_id = p.id
              limit 1) as price_cents
      from products p
      where p.company_id = ${auth.company.companyId} and p.active
      order by p.name
      limit 40
    `);
    return ok({
      canEdit: can(auth.permissions, "estacion", "editar"),
      canCreate: can(auth.permissions, "estacion", "crear"),
      userId: auth.user.id,
      products,
      articles,
      attendants,
      nozzles,
      shifts,
      shift: open ? { ...open, ...detail } : null,
    });
  });
}

async function productBoard(tx: Tx, companyId: string) {
  const products = await tx.execute<{ id: string; code: string; name: string; unit: string; iva_rate_bps: number }>(sql`
    select id::text, code, name, unit, iva_rate_bps from fuel_products where company_id = ${companyId} and active order by name
  `);
  const prices = await tx.execute<{ product_id: string; cents_per_unit: string; valid_from: string }>(sql`
    select product_id::text, cents_per_unit::text, valid_from::text from fuel_prices where company_id = ${companyId}
  `);
  const taxes = await tx.execute<{ product_id: string; code: string; name: string; cents_per_unit: string; treatment: string; in_vat_base: boolean; valid_from: string }>(sql`
    select product_id::text, code, name, cents_per_unit::text, treatment, in_vat_base, valid_from::text
    from fuel_taxes where company_id = ${companyId}
  `);
  const now = new Date().toISOString();
  return products.map((product) => ({
    ...product,
    priceCents: priceAt(prices.filter((price) => price.product_id === product.id).map((price) => ({ validFrom: price.valid_from, cents: Number(price.cents_per_unit) })), now),
    taxes: currentTaxes(taxes.filter((tax) => tax.product_id === product.id), now),
  }));
}

function currentTaxes(rows: { code: string; name: string; cents_per_unit: string; treatment: string; in_vat_base: boolean; valid_from: string }[], at: string): FuelTax[] {
  const byCode = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (new Date(row.valid_from).getTime() > new Date(at).getTime()) continue;
    const previous = byCode.get(row.code);
    if (!previous || row.valid_from > previous.valid_from) byCode.set(row.code, row);
  }
  return [...byCode.values()].map((row) => ({
    code: row.code,
    name: row.name,
    centsPerUnit: Number(row.cents_per_unit),
    inVatBase: row.in_vat_base,
    treatment: row.treatment === "interno" ? "interno" : "no_gravado",
  }));
}

async function shiftDetail(tx: Tx, shiftId: string) {
  const [readings, payments, shop] = await Promise.all([
    tx.execute(sql`select id::text, nozzle_id::text, opening::text, closing::text, liters::text, price_cents::text, amount_cents::text from fuel_readings where shift_id = ${shiftId}`),
    tx.execute(sql`select id::text, method, amount_cents::text, note from fuel_payments where shift_id = ${shiftId}`),
    tx.execute(sql`select id::text, description, quantity::text, amount_cents::text from fuel_shop_lines where shift_id = ${shiftId}`),
  ]);
  return { readings, payments, shop };
}

async function openShift(req: Request) {
  const auth = await requirePermission("estacion", "crear");
  const body = await readBody(req, z.object({
    attendantId: z.string().uuid().optional(),
    attendantName: z.string().trim().min(1).max(80).optional(),
  }));
  const forOther = Boolean(body.attendantId && body.attendantId !== auth.user.id);
  if (forOther && !can(auth.permissions, "estacion", "editar")) throw new HttpError(403, "Solo el encargado abre el turno de otro playero");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const attendantId = forOther ? body.attendantId! : auth.user.id;
    const named = await tx.execute<{ name: string }>(sql`select name from users where id = ${attendantId}`);
    const attendantName = named[0]?.name;
    if (!attendantName) throw new HttpError(400, "No encontramos a ese playero");
    const open = await tx.execute<{ id: string }>(sql`
      select id::text from fuel_shifts where company_id = ${auth.company.companyId} and attendant_id = ${attendantId} and status = 'abierto' limit 1
    `);
    if (open[0]) throw new HttpError(400, "Esa persona ya tiene un turno abierto");
    const [shift] = await tx.execute<{ id: string }>(sql`
      insert into fuel_shifts (company_id, attendant_id, attendant_name)
      values (${auth.company.companyId}, ${attendantId}, ${attendantName})
      returning id::text
    `);
    const nozzles = await tx.execute<{ id: string; last_closing: string | null }>(sql`
      select n.id::text,
             coalesce(
               (select mr.reading::text from fuel_meter_resets mr
                 where mr.nozzle_id = n.id
                   and mr.reset_at >= coalesce((select s.opened_at from fuel_readings r join fuel_shifts s on s.id = r.shift_id where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1), '-infinity'::timestamptz)
                 order by mr.reset_at desc limit 1),
               (select r.closing::text from fuel_readings r
                  join fuel_shifts s on s.id = r.shift_id
                 where r.nozzle_id = n.id and r.closing is not null
                 order by s.opened_at desc limit 1)
             ) as last_closing
      from fuel_nozzles n
      join fuel_pumps pu on pu.id = n.pump_id
      where n.company_id = ${auth.company.companyId} and pu.active
    `);
    if (nozzles.length) {
      const values = nozzles.map((nozzle) => sql`(${auth.company.companyId}, ${shift.id}, ${nozzle.id}, ${Number(nozzle.last_closing ?? 0)})`);
      await tx.execute(sql`insert into fuel_readings (company_id, shift_id, nozzle_id, opening) values ${sql.join(values, sql`, `)}`);
    }
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.turno", entity: "turno", entityId: shift.id, summary: "Abrió un turno de playa" });
    return ok({ id: shift.id });
  });
}

async function saveReadings(req: Request) {
  const auth = await requirePermission("estacion", "crear");
  const body = await readBody(req, z.object({
    shiftId: z.string().uuid(),
    readings: z.array(z.object({ nozzleId: z.string().uuid(), closing: z.number().nonnegative() })).min(1),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownShift(tx, auth, body.shiftId);
    const products = await productBoard(tx, auth.company.companyId);
    const nozzles = await tx.execute<{ id: string; product_id: string; opening: string }>(sql`
      select n.id::text, n.product_id::text, r.opening::text
      from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id
      where r.shift_id = ${body.shiftId}
    `);
    for (const reading of body.readings) {
      const nozzle = nozzles.find((item) => item.id === reading.nozzleId);
      if (!nozzle) throw new HttpError(400, "Ese pico no está en el turno");
      const product = products.find((item) => item.id === nozzle.product_id);
      let liters: number;
      try {
        liters = litersSold(Number(nozzle.opening), reading.closing);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Aforador inválido");
      }
      const price = product?.priceCents ?? 0;
      const amount = Math.round(liters * price);
      await tx.execute(sql`
        update fuel_readings
        set closing = ${reading.closing}, liters = ${liters}, price_cents = ${price}, amount_cents = ${amount}
        where shift_id = ${body.shiftId} and nozzle_id = ${reading.nozzleId}
      `);
    }
    return ok({ saved: true });
  });
}

async function addShop(req: Request) {
  const auth = await requirePermission("estacion", "crear");
  const body = await readBody(req, z.object({
    shiftId: z.string().uuid(),
    description: z.string().trim().min(1).max(120),
    quantity: z.number().positive(),
    amountCents: z.number().int().nonnegative(),
    productId: z.string().uuid().optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownShift(tx, auth, body.shiftId);
    let description = body.description;
    let amount = body.amountCents;
    if (body.productId) {
      const rows = await tx.execute<{ name: string; tracks_stock: boolean; price_cents: string | null }>(sql`
        select p.name, p.tracks_stock,
               (select pp.price_cents::text from product_prices pp
                 join price_lists l on l.id = pp.price_list_id and l.is_default
                where pp.product_id = p.id limit 1) as price_cents
        from products p
        where p.id = ${body.productId} and p.company_id = ${auth.company.companyId}
      `);
      const product = rows[0];
      if (!product) throw new HttpError(400, "No encontramos ese artículo");
      if (!description) description = product.name;
      if (amount === 0 && product.price_cents) amount = Math.round(body.quantity * Number(product.price_cents));
      if (product.tracks_stock) {
        const warehouses = await tx.execute<{ id: string }>(sql`
          select id::text from warehouses where company_id = ${auth.company.companyId} order by is_default desc, name limit 1
        `);
        const warehouseId = warehouses[0]?.id;
        if (!warehouseId) throw new HttpError(400, "Definí un depósito para descontar el shop");
        const delta = (-body.quantity).toFixed(3);
        const updated = await tx.execute<{ quantity: string }>(sql`
          insert into stock_levels (product_id, warehouse_id, company_id, quantity)
          values (${body.productId}, ${warehouseId}, ${auth.company.companyId}, ${delta})
          on conflict (product_id, warehouse_id)
          do update set quantity = stock_levels.quantity + excluded.quantity
          returning quantity::text as quantity
        `);
        if (Number(updated[0]?.quantity ?? 0) < -0.0001) throw new HttpError(409, "No hay stock de ese artículo en el shop");
        await tx.execute(sql`
          insert into stock_movements (company_id, product_id, warehouse_id, quantity, reason, created_by)
          values (${auth.company.companyId}, ${body.productId}, ${warehouseId}, ${delta}, 'shop', ${auth.user.id})
        `);
      }
    }
    await tx.execute(sql`
      insert into fuel_shop_lines (company_id, shift_id, product_id, description, quantity, amount_cents)
      values (${auth.company.companyId}, ${body.shiftId}, ${body.productId ?? null}, ${description}, ${body.quantity}, ${amount})
    `);
    return ok({ saved: true, amountCents: amount });
  });
}

async function closeShift(req: Request) {
  const auth = await requirePermission("estacion", "crear");
  const body = await readBody(req, z.object({
    shiftId: z.string().uuid(),
    invoicedCents: z.number().int().nonnegative().default(0),
    notes: z.string().max(400).optional(),
    payments: z.array(z.object({
      method: z.enum(["efectivo", "tarjeta", "qr", "cuenta_corriente", "vale"]),
      amountCents: z.number().int().nonnegative(),
      note: z.string().max(120).optional(),
    })),
    readings: z.array(z.object({ nozzleId: z.string().uuid(), closing: z.number().nonnegative() })).optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await ownShift(tx, auth, body.shiftId);
    if (body.readings?.length) {
      const products = await productBoard(tx, auth.company.companyId);
      const nozzles = await tx.execute<{ id: string; product_id: string; opening: string }>(sql`
        select n.id::text, n.product_id::text, r.opening::text
        from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id
        where r.shift_id = ${body.shiftId}
      `);
      for (const reading of body.readings) {
        const nozzle = nozzles.find((item) => item.id === reading.nozzleId);
        if (!nozzle) throw new HttpError(400, "Ese pico no está en el turno");
        const product = products.find((item) => item.id === nozzle.product_id);
        let liters: number;
        try {
          liters = litersSold(Number(nozzle.opening), reading.closing);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : "Aforador inválido");
        }
        const price = product?.priceCents ?? 0;
        await tx.execute(sql`
          update fuel_readings set closing = ${reading.closing}, liters = ${liters}, price_cents = ${price}, amount_cents = ${Math.round(liters * price)}
          where shift_id = ${body.shiftId} and nozzle_id = ${reading.nozzleId}
        `);
      }
    }
    await tx.execute(sql`delete from fuel_payments where shift_id = ${body.shiftId}`);
    if (body.payments.length) {
      const values = body.payments.map((payment) => sql`(${auth.company.companyId}, ${body.shiftId}, ${payment.method}, ${payment.amountCents}, ${payment.note ?? null})`);
      await tx.execute(sql`insert into fuel_payments (company_id, shift_id, method, amount_cents, note) values ${sql.join(values, sql`, `)}`);
    }
    const totals = await tx.execute<{ fuel: string; shop: string }>(sql`
      select coalesce((select sum(amount_cents) from fuel_readings where shift_id = ${body.shiftId}), 0)::text as fuel,
             coalesce((select sum(amount_cents) from fuel_shop_lines where shift_id = ${body.shiftId}), 0)::text as shop
    `);
    const collected = body.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const row = totals[0];
    if (!row) throw new HttpError(500, "No pude totalizar el turno");
    const gap = shiftGap({ fuelCents: Number(row.fuel), shopCents: Number(row.shop), collectedCents: collected, invoicedCents: body.invoicedCents ?? 0 });
    await tx.execute(sql`
      update fuel_shifts set status = 'cerrado', closed_at = now(), invoiced_cents = ${body.invoicedCents}, notes = ${body.notes ?? null}
      where id = ${body.shiftId}
    `);
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "estacion.cierre",
      entity: "turno",
      entityId: body.shiftId,
      summary: `Cerró el turno. ${cajaDifferenceText(Number(row.fuel) + Number(row.shop), collected)}`,
    });
    return ok(gap);
  });
}

async function tanks() {
  const auth = await requirePermission("estacion", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const tanks = await tx.execute<{ id: string; name: string; product_name: string; unit: string; capacity: string }>(sql`
      select t.id::text, t.name, p.name as product_name, p.unit, t.capacity::text
      from fuel_tanks t join fuel_products p on p.id = t.product_id
      where t.company_id = ${auth.company.companyId} and t.active order by t.name
    `);
    const sticks = await tx.execute<{ tank_id: string; measured_at: string; liters: string }>(sql`
      select tank_id::text, measured_at::text, liters::text from fuel_sticks where company_id = ${auth.company.companyId} order by measured_at
    `);
    const deliveries = await tx.execute<{ tank_id: string; delivered_at: string; liters: string; supplier_name: string; remito: string | null }>(sql`
      select tank_id::text, delivered_at::text, liters::text, supplier_name, remito from fuel_deliveries where company_id = ${auth.company.companyId}
    `);
    const sold = await tx.execute<{ tank_id: string; at: string; liters: string }>(sql`
      select n.tank_id::text, s.closed_at::text as at, r.liters::text
      from fuel_readings r
      join fuel_shifts s on s.id = r.shift_id
      join fuel_nozzles n on n.id = r.nozzle_id
      where r.company_id = ${auth.company.companyId} and s.status = 'cerrado' and s.closed_at is not null
      union all
      select e.tank_id::text, e.occurred_at::text as at,
             (case when e.kind = 'carga' then e.liters else -e.liters end)::text
      from fuel_trip_events e
      where e.company_id = ${auth.company.companyId} and e.kind in ('carga', 'retorno') and e.tank_id is not null
    `);
    const view = tanks.map((tank) => {
      const measures = sticks.filter((stick) => stick.tank_id === tank.id);
      const current = measures.at(-1);
      const previous = measures.at(-2);
      const from = previous?.measured_at ?? "1970-01-01";
      const to = current?.measured_at ?? new Date().toISOString();
      const deliveryLiters = windowLiters(deliveries.filter((item) => item.tank_id === tank.id).map((item) => ({ at: item.delivered_at, liters: Number(item.liters) })), from, to);
      const movements = sold.filter((item) => item.tank_id === tank.id).map((item) => ({ at: item.at, liters: Number(item.liters) }));
      const soldLiters = windowLiters(movements, from, to);
      const reconciliation = current && previous ? reconcileTank({ previousStick: Number(previous.liters), deliveries: deliveryLiters, sold: soldLiters, currentStick: Number(current.liters) }) : null;
      return { ...tank, current, previous, deliveryLiters, soldLiters, reconciliation };
    });
    return ok({ canEdit: can(auth.permissions, "estacion", "editar"), tanks: view, deliveries });
  });
}

async function stick(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({ tankId: z.string().uuid(), liters: z.number().nonnegative(), note: z.string().max(200).optional() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const tank = await tankFacts(tx, auth.company.companyId, body.tankId);
    if (!withinCapacity(tank.capacity, body.liters)) throw new HttpError(409, `${tank.name} entra hasta ${formatMeasure(tank.capacity, tank.unit)}`);
    await tx.execute(sql`
      insert into fuel_sticks (company_id, tank_id, liters, note, user_id)
      values (${auth.company.companyId}, ${body.tankId}, ${body.liters}, ${body.note ?? null}, ${auth.user.id})
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.varilla", entity: "tanque", entityId: body.tankId, summary: `Varilló ${tank.name}: ${body.liters} ${tank.unit}` });
    return ok({ saved: true });
  });
}

async function delivery(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({ tankId: z.string().uuid(), supplierName: z.string().trim().min(1), liters: z.number().positive(), remito: z.string().max(40).optional() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const tank = await tankFacts(tx, auth.company.companyId, body.tankId);
    const projected = await tankVolume(tx, auth.company.companyId, body.tankId) + body.liters;
    if (!withinCapacity(tank.capacity, projected)) throw new HttpError(409, `${tank.name} no da: quedarían ${formatMeasure(projected, tank.unit)} y la capacidad es ${formatMeasure(tank.capacity, tank.unit)}`);
    await tx.execute(sql`
      insert into fuel_deliveries (company_id, tank_id, supplier_name, liters, remito)
      values (${auth.company.companyId}, ${body.tankId}, ${body.supplierName}, ${body.liters}, ${body.remito ?? null})
    `);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.descarga", entity: "tanque", entityId: body.tankId, summary: `Descargó ${body.liters} ${tank.unit} de ${body.supplierName} en ${tank.name}` });
    return ok({ saved: true });
  });
}

async function tankFacts(tx: Tx, companyId: string, tankId: string) {
  const rows = await tx.execute<{ name: string; capacity: string; unit: string }>(sql`
    select t.name, t.capacity::text, p.unit
    from fuel_tanks t join fuel_products p on p.id = t.product_id
    where t.id = ${tankId} and t.company_id = ${companyId}
  `);
  const tank = rows[0];
  if (!tank) throw new HttpError(404, "No encontramos el tanque");
  return { name: tank.name, capacity: Number(tank.capacity), unit: tank.unit };
}

async function tankVolume(tx: Tx, companyId: string, tankId: string) {
  const rows = await tx.execute<{ volume: string }>(sql`
    select (
      coalesce((select liters from fuel_sticks where tank_id = ${tankId} order by measured_at desc limit 1), 0)
      + coalesce((select sum(liters) from fuel_deliveries where tank_id = ${tankId} and delivered_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${tankId}), '-infinity')), 0)
      - coalesce((select sum(r.liters) from fuel_readings r join fuel_shifts s on s.id = r.shift_id join fuel_nozzles n on n.id = r.nozzle_id
                  where n.tank_id = ${tankId} and s.status = 'cerrado' and s.closed_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${tankId}), '-infinity')), 0)
      - coalesce((select sum(case when kind = 'carga' then liters else -liters end) from fuel_trip_events
                  where tank_id = ${tankId} and kind in ('carga', 'retorno') and occurred_at > coalesce((select max(measured_at) from fuel_sticks where tank_id = ${tankId}), '-infinity')), 0)
    )::text as volume
  `);
  void companyId;
  return Number(rows[0]?.volume ?? 0);
}

async function prices() {
  const auth = await requirePermission("estacion", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => ok({ canEdit: can(auth.permissions, "estacion", "editar"), products: await productBoard(tx, auth.company.companyId) }));
}

async function setPrice(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({
    productId: z.string().uuid(),
    cents: z.number().int().positive(),
    validFrom: z.string().optional(),
    taxes: z.array(z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      centsPerUnit: z.number().int().nonnegative(),
      treatment: z.enum(["interno", "no_gravado"]),
      inVatBase: z.boolean(),
    })).optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const from = body.validFrom ?? new Date().toISOString();
    await tx.execute(sql`
      insert into fuel_prices (company_id, product_id, cents_per_unit, valid_from)
      values (${auth.company.companyId}, ${body.productId}, ${body.cents}, ${from})
    `);
    if (body.taxes) {
      for (const tax of body.taxes) {
        await tx.execute(sql`
          insert into fuel_taxes (company_id, product_id, code, name, cents_per_unit, treatment, in_vat_base, valid_from)
          values (${auth.company.companyId}, ${body.productId}, ${tax.code}, ${tax.name}, ${tax.centsPerUnit}, ${tax.treatment}, ${tax.inVatBase}, ${from})
        `);
      }
    }
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.precio", entity: "combustible", entityId: body.productId, summary: "Cambió el precio de surtidor" });
    return ok({ saved: true });
  });
}

async function fleetClients() {
  const auth = await requirePermission("estacion", "ver");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const customers = await tx.execute<{ id: string; name: string }>(sql`
      select c.id::text, c.name
      from customers c
      where c.company_id = ${companyId} and c.active
        and (
          exists (select 1 from fleet_vehicles v where v.company_id = c.company_id and v.customer_id = c.id)
          or exists (select 1 from fleet_drivers d where d.company_id = c.company_id and d.customer_id = c.id)
          or exists (select 1 from fleet_vouchers f where f.company_id = c.company_id and f.customer_id = c.id)
        )
      order by c.name
      limit 100
    `);
    const vehicles = await tx.execute<{ id: string; customer_id: string; plate: string; limit_cents: string | null }>(sql`
      select id::text, customer_id::text, plate, limit_cents::text
      from fleet_vehicles
      where company_id = ${companyId} and active
      order by plate
    `);
    const drivers = await tx.execute<{ id: string; customer_id: string; name: string }>(sql`
      select id::text, customer_id::text, name
      from fleet_drivers
      where company_id = ${companyId} and active
      order by name
    `);
    return ok({ customers, vehicles, drivers });
  });
}

async function fleet(url: URL) {
  const auth = await requirePermission("estacion", "ver");
  const customerId = url.searchParams.get("customerId");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const customers = await tx.execute<{ id: string; name: string; cuit: string | null }>(sql`
      select id::text, name, cuit from customers where company_id = ${auth.company.companyId} and active order by name limit 100
    `);
    const vehicles = await tx.execute(sql`select id::text, customer_id::text, plate, description, limit_cents::text from fleet_vehicles where company_id = ${auth.company.companyId} and active`);
    const drivers = await tx.execute(sql`select id::text, customer_id::text, name, document from fleet_drivers where company_id = ${auth.company.companyId} and active`);
    const vouchers = await tx.execute(sql`
      select v.id::text, v.customer_id::text, v.liters::text, v.amount_cents::text, v.issued_on::text, v.status, p.name as product, p.unit, ve.plate
      from fleet_vouchers v
      join fuel_products p on p.id = v.product_id
      left join fleet_vehicles ve on ve.id = v.vehicle_id
      where v.company_id = ${auth.company.companyId}
        and (${customerId}::uuid is null or v.customer_id = ${customerId}::uuid)
      order by v.issued_on desc
      limit 80
    `);
    const products = await productBoard(tx, auth.company.companyId);
    return ok({
      canEdit: can(auth.permissions, "estacion", "editar"),
      canCreate: can(auth.permissions, "estacion", "crear"),
      customers, vehicles, drivers, vouchers, products,
    });
  });
}

async function addVehicle(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({ customerId: z.string().uuid("Elegí el cliente"), plate: z.string().trim().min(1).max(12), description: z.string().max(80).optional(), limitCents: z.number().int().nonnegative().optional() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const plate = normalizePlate(body.plate);
    if (plate.length < 5) throw new HttpError(400, "La patente tiene que ser como ABC123 o AB123CD");
    await tx.execute(sql`
      insert into fleet_vehicles (company_id, customer_id, plate, description, limit_cents)
      values (${auth.company.companyId}, ${body.customerId}, ${plate}, ${body.description ?? null}, ${body.limitCents ?? null})
    `);
    return ok({ saved: true });
  });
}

async function addDriver(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({ customerId: z.string().uuid("Elegí el cliente"), name: z.string().trim().min(1), document: z.string().max(20).optional() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await tx.execute(sql`insert into fleet_drivers (company_id, customer_id, name, document) values (${auth.company.companyId}, ${body.customerId}, ${body.name}, ${body.document ?? null})`);
    return ok({ saved: true });
  });
}

async function addVoucher(req: Request) {
  const auth = await requirePermission("estacion", "crear");
  const body = await readBody(req, z.object({
    customerId: z.string().uuid(),
    vehicleId: z.string().uuid().optional(),
    plate: z.string().trim().max(12).optional(),
    driverId: z.string().uuid().optional(),
    shiftId: z.string().uuid().optional(),
    productId: z.string().uuid(),
    liters: z.number().positive(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const products = await productBoard(tx, auth.company.companyId);
    const product = products.find((item) => item.id === body.productId);
    if (!product?.priceCents) throw new HttpError(400, "Ese combustible no tiene precio");
    let vehicleId = body.vehicleId ?? null;
    const plate = (body.plate ?? "").replace(/[\s-]+/g, "").toUpperCase();
    if (!vehicleId && plate) {
      const found = await tx.execute<{ id: string }>(sql`
        select id::text from fleet_vehicles
        where company_id = ${auth.company.companyId} and customer_id = ${body.customerId}::uuid
          and upper(replace(replace(plate, ' ', ''), '-', '')) = ${plate}
        limit 1
      `);
      vehicleId = found[0]?.id ?? null;
    }
    if (vehicleId) {
      const limit = await tx.execute<{ limit_cents: string | null; spent: string }>(sql`
        select v.limit_cents::text,
               coalesce((select sum(amount_cents) from fleet_vouchers where vehicle_id = v.id and status = 'abierto'), 0)::text as spent
        from fleet_vehicles v where v.id = ${vehicleId} and v.company_id = ${auth.company.companyId}
      `);
      const cap = limit[0]?.limit_cents ? Number(limit[0].limit_cents) : null;
      const amount = Math.round(body.liters * product.priceCents);
      if (cap != null && Number(limit[0].spent) + amount > cap) throw new HttpError(409, "El vale supera el límite del vehículo");
    }
    const amount = Math.round(body.liters * product.priceCents);
    await tx.execute(sql`
      insert into fleet_vouchers (company_id, customer_id, vehicle_id, driver_id, shift_id, product_id, liters, amount_cents, issued_on)
      values (${auth.company.companyId}, ${body.customerId}, ${vehicleId}, ${body.driverId ?? null}, ${body.shiftId ?? null}, ${body.productId}, ${body.liters}, ${amount}, ${todayIso()}::date)
    `);
    return ok({ amountCents: amount });
  });
}

async function billFleet(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  if (!can(auth.permissions, "ventas", "crear")) throw new HttpError(403, "Para facturar la flota también hace falta permiso de ventas");
  const body = await readBody(req, z.object({ customerId: z.string().uuid().optional(), from: z.string(), to: z.string() }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const vouchers = await tx.execute<{ id: string; customer_id: string; product_id: string; liters: string }>(sql`
      select id::text, customer_id::text, product_id::text, liters::text from fleet_vouchers
      where company_id = ${auth.company.companyId} and status = 'abierto'
        and (${body.customerId ?? null}::uuid is null or customer_id = ${body.customerId ?? null}::uuid)
        and issued_on between ${body.from} and ${body.to}
    `);
    if (!vouchers.length) throw new HttpError(400, "No hay vales abiertos en ese período");
    const products = await productBoard(tx, auth.company.companyId);
    const customerIds = [...new Set(vouchers.map((voucher) => voucher.customer_id))];
    const [dtype] = await tx.execute<{ id: string; next_number: number }>(sql`
      select id::text, next_number from document_types where company_id = ${auth.company.companyId} and code = 'FAC' and kind = 'venta' for update
    `);
    if (!dtype) throw new HttpError(400, "Definí una factura de venta antes de facturar la flota");
    const issued = todayIso();
    const documents: { documentId: string; customerId: string; totalCents: number }[] = [];
    let number = dtype.next_number;
    for (const customerId of customerIds) {
    const mine = vouchers.filter((voucher) => voucher.customer_id === customerId);
    const [customer] = await tx.execute<{ name: string; cuit: string | null; tax_condition: string }>(sql`
      select name, cuit, tax_condition from customers where id = ${customerId}
    `);
    if (!customer) throw new HttpError(404, "No encontramos el cliente");
    const issuer = isTaxCondition(auth.company.taxCondition) ? auth.company.taxCondition : "ri";
    const receiver = isTaxCondition(customer.tax_condition) ? customer.tax_condition : "cf";
    const letter = resolveLetter(issuer, receiver);
    const grouped = new Map<string, number>();
    for (const voucher of mine) grouped.set(voucher.product_id, (grouped.get(voucher.product_id) ?? 0) + Number(voucher.liters));
    let net = 0;
    let vat = 0;
    let other = 0;
    let untaxed = 0;
    const lines: { name: string; liters: number; split: ReturnType<typeof splitPumpSale> }[] = [];
    for (const [productId, liters] of grouped) {
      const product = products.find((item) => item.id === productId);
      if (!product?.priceCents) throw new HttpError(400, "Falta el precio de un combustible");
      const split = splitPumpSale({
        quantity: liters,
        pumpPriceCents: product.priceCents,
        ivaRateBps: letter === "C" ? 0 : product.iva_rate_bps,
        taxes: product.taxes,
      });
      if (letter === "C") untaxed += split.vatBaseCents;
      else {
        net += split.vatBaseCents;
        vat += split.vatCents;
      }
      for (const tax of split.taxes) {
        if (tax.treatment === "interno") other += tax.amountCents;
        else untaxed += tax.amountCents;
      }
      lines.push({ name: product.name, liters, split });
    }
    const total = net + vat + other + untaxed;
    const [document] = await tx.execute<{ id: string }>(sql`
      insert into documents (
        company_id, kind, document_type_id, letter, point_of_sale, number, issued_on, party_type, party_id,
        party_name, party_cuit, party_tax_condition, payment_method, price_mode, status, notes,
        net_taxed_cents, net_untaxed_cents, exempt_cents, vat_cents, perceptions_cents, other_taxes_cents, total_cents, created_by
      ) values (
        ${auth.company.companyId}, 'venta', ${dtype.id}, ${letter}, ${auth.company.pointOfSale}, ${number}, ${issued}::date,
        'customer', ${customerId}, ${customer.name}, ${customer.cuit}, ${customer.tax_condition}, 'cuenta_corriente',
        ${priceModeForLetter(letter, letter !== "C")}, 'confirmado', 'Facturación de flota',
        ${net}, ${untaxed}, 0, ${vat}, 0, ${other}, ${total}, ${auth.user.id}
      ) returning id::text
    `);
    let position = 1;
    for (const line of lines) {
      const lineNet = letter === "C" ? 0 : line.split.vatBaseCents;
      const lineVat = letter === "C" ? 0 : line.split.vatCents;
      const lineUntaxed = letter === "C" ? line.split.vatBaseCents : 0;
      await tx.execute(sql`
        insert into document_lines (company_id, document_id, position, description, quantity, unit_price_cents, discount_bps, iva_rate_bps, tax_treatment, net_cents, vat_cents, exempt_cents, untaxed_cents, total_cents)
        values (
          ${auth.company.companyId}, ${document.id}, ${position}, ${line.name}, ${line.liters},
          ${Math.round(line.split.grossCents / line.liters)}, 0, ${letter === "C" ? 0 : 2100},
          ${letter === "C" ? "no_gravado" : "gravado"}, ${lineNet}, ${lineVat}, 0, ${lineUntaxed},
          ${lineNet + lineVat + lineUntaxed}
        )
      `);
      position += 1;
    }
    const taxTotals = new Map<string, { name: string; treatment: string; amount: number }>();
    for (const line of lines) {
      for (const tax of line.split.taxes) {
        const current = taxTotals.get(tax.code) ?? { name: tax.name, treatment: tax.treatment, amount: 0 };
        current.amount += tax.amountCents;
        taxTotals.set(tax.code, current);
      }
    }
    for (const tax of taxTotals.values()) {
      await tx.execute(sql`
        insert into document_taxes (company_id, document_id, name, rate_bps, base_cents, amount_cents)
        values (${auth.company.companyId}, ${document.id}, ${tax.name}, 0, ${net}, ${tax.amount})
      `);
    }
    await tx.execute(sql`
      insert into current_account_entries (company_id, party_type, party_id, document_id, occurred_on, description, debit_cents, credit_cents)
      values (${auth.company.companyId}, 'customer', ${customerId}, ${document.id}, ${issued}::date, 'Factura de flota', ${total}, 0)
    `);
    const ids = sql.join(mine.map((voucher) => sql`${voucher.id}::uuid`), sql`, `);
    await tx.execute(sql`update fleet_vouchers set status = 'facturado', document_id = ${document.id}::uuid where id in (${ids})`);
    await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.flota", entity: "cliente", entityId: customerId, summary: `Facturó vales de flota por ${total / 100}` });
    documents.push({ documentId: document.id, customerId, totalCents: total });
    number += 1;
    }
    await tx.execute(sql`update document_types set next_number = ${number} where id = ${dtype.id}`);
    return ok({ documents, documentId: documents[0]?.documentId, totalCents: documents.reduce((sum, item) => sum + item.totalCents, 0) });
  });
}

async function report(url: URL) {
  const auth = await requirePermission("informes", "ver");
  const from = url.searchParams.get("desde") ?? todayIso(new Date(Date.now() - 90 * 864e5));
  const to = url.searchParams.get("hasta") ?? todayIso();
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const rows = await tx.execute<{ product: string; nozzle: number; attendant: string; liters: string; amount: string }>(sql`
      select fp.name as product, n.number as nozzle, s.attendant_name as attendant,
             sum(r.liters)::text as liters, sum(r.amount_cents)::text as amount
      from fuel_readings r
      join fuel_shifts s on s.id = r.shift_id
      join fuel_nozzles n on n.id = r.nozzle_id
      join fuel_products fp on fp.id = n.product_id
      where s.company_id = ${auth.company.companyId}
        and (
          (s.opened_at at time zone 'America/Argentina/Buenos_Aires')::date between ${from}::date and ${to}::date
          or (s.closed_at at time zone 'America/Argentina/Buenos_Aires')::date between ${from}::date and ${to}::date
        )
        and (${!can(auth.permissions, "estacion", "editar")} = false or s.attendant_id = ${auth.user.id})
      group by fp.name, n.number, s.attendant_name
      order by fp.name, n.number, s.attendant_name
    `);
    return ok({ from, to, rows });
  });
}

async function ownShift(tx: Tx, auth: { user: { id: string }; permissions: Set<string>; company: { companyId: string } }, shiftId: string) {
  const rows = await tx.execute<{ attendant_id: string | null; status: string }>(sql`
    select attendant_id::text, status from fuel_shifts where id = ${shiftId} and company_id = ${auth.company.companyId}
  `);
  const shift = rows[0];
  if (!shift) throw new HttpError(404, "No encontramos el turno");
  if (shift.status !== "abierto") throw new HttpError(400, "Ese turno ya está cerrado");
  if (!can(auth.permissions, "estacion", "editar") && shift.attendant_id !== auth.user.id) {
    throw new HttpError(403, "Solo podés cargar tu propio turno");
  }
}
