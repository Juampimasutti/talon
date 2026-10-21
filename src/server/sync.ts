import { sql } from "drizzle-orm";
import { z } from "zod";
import { can, moduleEnabled } from "@/lib/auth/permissions";
import { requirePermission, type AuthContext } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/domain/audit";
import { createDocument } from "@/lib/domain/documents";
import { formatMoney, parseInputNumber, todayIso } from "@/lib/format";
import { CURRENT_FUEL_TAXES_SQL, fuelSaleDraft, litersSold, oneTaxPerCode, pumpInvoiceParts, splitGrossSale, type FuelTax } from "@/lib/estacion/calc";
import { OP_KINDS, priceDiscrepancy, sortQueue, stockDecision, type QueuedOp } from "@/lib/offline/engine";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

export async function sync(method: string, path: string[], req: Request): Promise<Response> {
  const area = path[1];
  if (method === "GET" && area === "referencia") return reference();
  if (method === "GET" && area === "conflictos") return listConflicts();
  if (method === "POST" && !area) return push(req);
  throw new HttpError(404, "No existe esa ruta");
}

async function reference() {
  const auth = await requirePermission("dashboard", "ver");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const articles = can(auth.permissions, "articulos", "ver")
      ? await tx.execute<{ id: string; sku: string; name: string; price_cents: string | null; tracks_stock: boolean }>(sql`
          select p.id::text, p.sku, p.name, p.tracks_stock,
            (select pp.price_cents::text from product_prices pp join price_lists l on l.id = pp.price_list_id and l.is_default where pp.product_id = p.id limit 1) as price_cents
          from products p where p.company_id = ${companyId} and p.active order by p.name limit 80
        `)
      : [];
    const fuel = can(auth.permissions, "estacion", "ver")
      ? await tx.execute<{ id: string; code: string; name: string; unit: string; price_cents: string | null }>(sql`
          select p.id::text, p.code, p.name, p.unit,
            (select cents_per_unit::text from fuel_prices where product_id = p.id and valid_from <= now() order by valid_from desc limit 1) as price_cents
          from fuel_products p where p.company_id = ${companyId} and p.active order by p.name
        `)
      : [];
    const nozzles = can(auth.permissions, "estacion", "ver")
      ? await tx.execute(sql`
          select n.id::text, n.number, pu.name as pump_name, fp.name as product_name, n.product_id::text,
            (select r.closing::text from fuel_readings r join fuel_shifts s on s.id = r.shift_id where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1) as last_closing
          from fuel_nozzles n
          join fuel_pumps pu on pu.id = n.pump_id
          join fuel_products fp on fp.id = n.product_id
          where n.company_id = ${companyId}
          order by pu.name, n.number
        `)
      : [];
    const tanks = can(auth.permissions, "estacion", "ver")
      ? await tx.execute(sql`select t.id::text, t.name, t.capacity::text, p.name as product_name, p.unit from fuel_tanks t join fuel_products p on p.id = t.product_id where t.company_id = ${companyId} order by t.name`)
      : [];
    const customers = can(auth.permissions, "clientes", "ver") || can(auth.permissions, "estacion", "ver") || can(auth.permissions, "reparto", "ver")
      ? await tx.execute(sql`select id::text, name from customers where company_id = ${companyId} and active order by name limit 100`)
      : [];
    const vehicles = can(auth.permissions, "estacion", "ver")
      ? await tx.execute(sql`select id::text, customer_id::text, plate from fleet_vehicles where company_id = ${companyId} and active`)
      : [];
    const vouchers = can(auth.permissions, "estacion", "ver")
      ? await tx.execute(sql`
          select v.id::text, v.customer_id::text, v.product_id::text, v.liters::text, v.amount_cents::text, c.name as customer
          from fleet_vouchers v join customers c on c.id = v.customer_id
          where v.company_id = ${companyId} and v.status = 'abierto' order by v.issued_on desc limit 80
        `)
      : [];
    const ownReparto = !can(auth.permissions, "reparto", "editar");
    const trucks = can(auth.permissions, "reparto", "ver")
      ? await tx.execute(sql`
          select id::text, plate, name from fuel_trucks
          where company_id = ${companyId} and active
            and (${ownReparto} = false or id in (select truck_id from fuel_trips where company_id = ${companyId} and driver_user_id = ${auth.user.id}))
          order by name
        `)
      : [];
    const compartments = can(auth.permissions, "reparto", "ver")
      ? await tx.execute(sql`
          select c.id::text, c.truck_id::text, c.name, c.quantity::text, c.capacity::text, p.name as product_name
          from fuel_compartments c join fuel_products p on p.id = c.product_id
          where c.company_id = ${companyId}
            and (${ownReparto} = false or c.truck_id in (select truck_id from fuel_trips where company_id = ${companyId} and driver_user_id = ${auth.user.id}))
        `)
      : [];
    const [recovery]=await tx.execute<{version:string|null}>(sql`select company_restore_version()::text as version`);
    return ok({ recoveryVersion:recovery.version, fetchedAt: new Date().toISOString(), articles, fuel, nozzles, tanks, customers, vehicles, vouchers, trucks, compartments });
  });
}

async function listConflicts() {
  const auth = await requirePermission("dashboard", "ver");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const rows = await tx.execute(sql`
      select id::text, op_key, kind, reason, created_at::text
      from sync_conflicts where company_id = ${auth.company.companyId}
      order by created_at desc limit 40
    `);
    return ok({ items: rows });
  });
}

async function push(req: Request) {
  const auth = await requirePermission("dashboard", "ver");
  const body = await readBody(req, z.object({
    operations: z.array(z.object({
      key: z.string().min(8).max(80),
      kind: z.string().refine((value): value is QueuedOp["kind"] => (OP_KINDS as readonly string[]).includes(value)),
      payload: z.record(z.string(), z.any()),
      createdAt: z.string(),
      recoveryVersion:z.string().uuid().nullable().optional(),
    })).max(40),
  }));
  const ordered = sortQueue(body.operations as QueuedOp[]);
  const results: { key: string; kind: string; status: string; reason?: string; message?: string; body?: unknown }[] = [];
  for (const op of ordered) {
    try {
      const result = await withTenant(auth.company.companyId, auth.user.id, (tx) => applyOne(tx, auth, op));
      results.push({ key: op.key, kind: op.kind, ...result });
    } catch (error) {
      results.push({ key: op.key, kind: op.kind, status: "error", message: error instanceof HttpError ? error.message : "No se pudo sincronizar esta operación" });
    }
  }
  return ok({ results });
}

async function applyOne(tx: Tx, auth: AuthContext, op: QueuedOp) {
  if (!kindAllowed(auth, op.kind)) throw new HttpError(403, "No tenés permiso para sincronizar eso");
  const existing = await tx.execute<{ result: { status: string; reason?: string; body?: unknown } }>(sql`
    select result from idempotency_keys where company_id = ${auth.company.companyId} and key = ${op.key}
  `);
  if (existing[0]) return { status: "duplicate", body: existing[0].result };
  const [recovery]=await tx.execute<{version:string|null}>(sql`select company_restore_version()::text as version`);
  const result = recovery.version !== (op.recoveryVersion ?? null)
    ? {status:"conflict" as const,reason:"Esta operación fue preparada antes de recuperar la empresa. Revisala antes de volver a cargarla para evitar duplicados."}
    : await runOp(tx, auth, op);
  await tx.execute(sql`
    insert into idempotency_keys (company_id, key, user_id, kind, status, result)
    values (${auth.company.companyId}, ${op.key}, ${auth.user.id}, ${op.kind}, ${result.status}, ${JSON.stringify(result)}::jsonb)
  `);
  if (result.status === "conflict" && result.reason) {
    await tx.execute(sql`
      insert into sync_conflicts (company_id, user_id, op_key, kind, reason)
      values (${auth.company.companyId}, ${auth.user.id}, ${op.key}, ${op.kind}, ${result.reason})
    `);
  }
  return result;
}

function kindAllowed(auth: AuthContext, kind: QueuedOp["kind"]) {
  if (kind.startsWith("reparto")) return can(auth.permissions, "reparto", "crear");
  if (kind === "comprobante") return can(auth.permissions, "ventas", "crear") || can(auth.permissions, "remitos", "crear");
  return can(auth.permissions, "estacion", "crear");
}

async function runOp(tx: Tx, auth: AuthContext, op: QueuedOp): Promise<{ status: string; reason?: string; body?: unknown }> {
  const payload = op.payload;
  const companyId = auth.company.companyId;
  if (op.kind === "turno") {
    const id = String(payload.id ?? crypto.randomUUID());
    const forOther = payload.attendantId && payload.attendantId !== auth.user.id;
    if (forOther && !can(auth.permissions, "estacion", "editar")) throw new HttpError(403, "Solo el encargado abre el turno de otro playero");
    const attendantId = forOther ? String(payload.attendantId) : auth.user.id;
    const named = await tx.execute<{ name: string }>(sql`select name from users where id = ${attendantId}`);
    const attendantName = named[0]?.name;
    if (!attendantName) throw new HttpError(400, "No encontramos a ese playero");
    const open = await tx.execute<{ id: string }>(sql`
      select id::text from fuel_shifts where company_id = ${companyId} and attendant_id = ${attendantId} and status = 'abierto' limit 1
    `);
    if (open[0]) return { status: "conflict", reason: "Ya hay un turno abierto en el servidor. No se abrió otro.", body: { id: open[0].id } };
    await tx.execute(sql`
      insert into fuel_shifts (id, company_id, attendant_id, attendant_name)
      values (${id}::uuid, ${companyId}, ${attendantId}, ${attendantName})
    `);
    const nozzles = await tx.execute<{ id: string; last_closing: string | null }>(sql`
      select n.id::text,
        coalesce(
          (select mr.reading::text from fuel_meter_resets mr
            where mr.nozzle_id = n.id
              and mr.reset_at >= coalesce((select s.opened_at from fuel_readings r join fuel_shifts s on s.id = r.shift_id where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1), '-infinity'::timestamptz)
            order by mr.reset_at desc limit 1),
          (select r.closing::text from fuel_readings r join fuel_shifts s on s.id = r.shift_id
            where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1)
        ) as last_closing
      from fuel_nozzles n
      join fuel_pumps pu on pu.id = n.pump_id
      where n.company_id = ${companyId} and pu.active
    `);
    for (const nozzle of nozzles) {
      await tx.execute(sql`insert into fuel_readings (company_id, shift_id, nozzle_id, opening) values (${companyId}, ${id}::uuid, ${nozzle.id}::uuid, ${Number(nozzle.last_closing ?? 0)})`);
    }
    return { status: "applied", body: { id } };
  }
  if (op.kind === "aforadores") {
    const readings = Array.isArray(payload.readings) ? payload.readings as { nozzleId: string; closing: unknown }[] : [];
    for (const reading of readings) {
      const closing = parseInputNumber(reading.closing);
      if (closing == null) throw new HttpError(400, "El aforador tiene que ser un número");
      const rows = await tx.execute<{ opening: string; product_id: string }>(sql`
        select r.opening::text, n.product_id::text from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id
        where r.shift_id = ${String(payload.shiftId)}::uuid and r.nozzle_id = ${reading.nozzleId}::uuid
      `);
      const nozzle = rows[0];
      if (!nozzle) throw new HttpError(400, "Ese pico no está en el turno");
      let liters: number;
      try {
        liters = litersSold(Number(nozzle.opening), closing);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "El cierre no puede ser menor que el inicio");
      }
      const priceRow = await tx.execute<{ cents: string }>(sql`
        select cents_per_unit::text as cents from fuel_prices where product_id = ${nozzle.product_id}::uuid and valid_from <= now() order by valid_from desc limit 1
      `);
      const price = Number(priceRow[0]?.cents ?? 0);
      await tx.execute(sql`
        update fuel_readings set closing = ${closing}, liters = ${liters}, price_cents = ${price}, amount_cents = ${Math.round(liters * price)}
        where shift_id = ${String(payload.shiftId)}::uuid and nozzle_id = ${reading.nozzleId}::uuid
      `);
    }
    return { status: "applied", body: { saved: true } };
  }
  if (op.kind === "shop") {
    if (!payload.productId) return { status: "error", reason: "Elegí un artículo del shop" };
    const quantity = parseInputNumber(payload.quantity ?? 1);
    if (quantity == null || quantity <= 0) throw new HttpError(400, "La cantidad tiene que ser mayor a cero");
    let amount = Number(payload.amountCents ?? 0);
    let tracks = false;
    if (payload.productId) {
      const rows = await tx.execute<{ tracks_stock: boolean; price_cents: string | null; quantity: string | null }>(sql`
        select p.tracks_stock,
          (select pp.price_cents::text from product_prices pp join price_lists l on l.id = pp.price_list_id and l.is_default where pp.product_id = p.id limit 1) as price_cents,
          (select s.quantity::text from stock_levels s join warehouses w on w.id = s.warehouse_id and w.is_default where s.product_id = p.id limit 1) as quantity
        from products p where p.id = ${String(payload.productId)}::uuid and p.company_id = ${companyId}
      `);
      const product = rows[0];
      if (!product) throw new HttpError(400, "No encontramos ese artículo");
      tracks = product.tracks_stock;
      if (!amount && product.price_cents) amount = Math.round(quantity * Number(product.price_cents));
      if (!(amount > 0)) return { status: "error", reason: "El importe del shop tiene que ser mayor a cero" };
      if (tracks) {
        const decision = stockDecision(quantity, Number(product.quantity ?? 0));
        if (!decision.apply) return { status: "conflict", reason: decision.reason, body: { saved: false, stockApplied: false, serverQuantity: Number(product.quantity ?? 0) } };
        const delta = (-quantity).toFixed(3);
        await tx.execute(sql`
          insert into stock_levels (product_id, warehouse_id, company_id, quantity)
          select ${String(payload.productId)}::uuid, w.id, ${companyId}, ${delta}::numeric
          from warehouses w where w.company_id = ${companyId} and w.is_default
          on conflict (product_id, warehouse_id) do update set quantity = stock_levels.quantity + excluded.quantity
        `);
      }
    }
    if (payload.productId) {
      await tx.execute(sql`
        insert into fuel_shop_lines (company_id, shift_id, product_id, description, quantity, amount_cents)
        values (${companyId}, ${String(payload.shiftId)}::uuid, ${String(payload.productId)}::uuid, ${String(payload.description ?? "Shop")}, ${quantity}, ${amount})
      `);
    } else {
      await tx.execute(sql`
        insert into fuel_shop_lines (company_id, shift_id, description, quantity, amount_cents)
        values (${companyId}, ${String(payload.shiftId)}::uuid, ${String(payload.description ?? "Shop")}, ${quantity}, ${amount})
      `);
    }
    return { status: "applied", body: { saved: true, amountCents: amount } };
  }
  if (op.kind === "cobro") {
    const pending = Array.isArray(payload.readings) ? payload.readings as { nozzleId: string; closing: unknown }[] : [];
    for (const reading of pending) {
      const closing = parseInputNumber(reading.closing);
      if (closing == null) throw new HttpError(400, "Hay un aforador sin guardar que no es un número");
      const rows = await tx.execute<{ opening: string; product_id: string }>(sql`
        select r.opening::text, n.product_id::text from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id
        where r.shift_id = ${String(payload.shiftId)}::uuid and r.nozzle_id = ${reading.nozzleId}::uuid
      `);
      const nozzle = rows[0];
      if (!nozzle) throw new HttpError(400, "Ese pico no está en el turno");
      let liters: number;
      try {
        liters = litersSold(Number(nozzle.opening), closing);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Aforador inválido");
      }
      const priceRow = await tx.execute<{ cents: string }>(sql`
        select cents_per_unit::text as cents from fuel_prices where product_id = ${nozzle.product_id}::uuid and valid_from <= now() order by valid_from desc limit 1
      `);
      const price = Number(priceRow[0]?.cents ?? 0);
      await tx.execute(sql`
        update fuel_readings set closing = ${closing}, liters = ${liters}, price_cents = ${price}, amount_cents = ${Math.round(liters * price)}
        where shift_id = ${String(payload.shiftId)}::uuid and nozzle_id = ${reading.nozzleId}::uuid
      `);
    }
    const payments = Array.isArray(payload.payments) ? payload.payments as { method: string; amountCents: number }[] : [];
    await tx.execute(sql`delete from fuel_payments where shift_id = ${String(payload.shiftId)}::uuid`);
    for (const payment of payments) {
      await tx.execute(sql`
        insert into fuel_payments (company_id, shift_id, method, amount_cents) values (${companyId}, ${String(payload.shiftId)}::uuid, ${payment.method}, ${payment.amountCents})
      `);
    }
    await tx.execute(sql`
      update fuel_shifts set status = 'cerrado', closed_at = now(), invoiced_cents = ${Number(payload.invoicedCents ?? 0)}
      where id = ${String(payload.shiftId)}::uuid and company_id = ${companyId}
    `);
    return { status: "applied", body: { closed: true } };
  }
  if (op.kind === "vale") {
    const liters = parseInputNumber(payload.liters);
    if (liters == null || liters <= 0) throw new HttpError(400, "La cantidad del vale tiene que ser mayor a cero");
    if (!isUuid(payload.customerId)) throw new HttpError(400, "Elegí un cliente de flota");
    const customer = await tx.execute<{ id: string }>(sql`
      select id::text from customers where id = ${String(payload.customerId)}::uuid and company_id = ${companyId}
    `);
    if (!customer[0]) throw new HttpError(400, "No encontramos el cliente");
    let vehicleId = isUuid(payload.vehicleId) ? String(payload.vehicleId) : null;
    const plate = String(payload.plate ?? "").replace(/[\s-]+/g, "").toUpperCase();
    if (!vehicleId && plate) {
      const found = await tx.execute<{ id: string }>(sql`
        select id::text from fleet_vehicles
        where company_id = ${companyId}
          and customer_id = ${String(payload.customerId)}::uuid
          and upper(replace(replace(plate, ' ', ''), '-', '')) = ${plate}
        limit 1
      `);
      vehicleId = found[0]?.id ?? null;
    }
    const priceRow = await tx.execute<{ cents: string }>(sql`
      select cents_per_unit::text as cents from fuel_prices where product_id = ${String(payload.productId)}::uuid and valid_from <= now() order by valid_from desc limit 1
    `);
    const amount = Math.round(liters * Number(priceRow[0]?.cents ?? 0));
    if (vehicleId) {
      const limit = await tx.execute<{ limit_cents: string | null; spent: string }>(sql`
        select limit_cents::text, coalesce((select sum(amount_cents) from fleet_vouchers where vehicle_id = v.id and status = 'abierto'), 0)::text as spent
        from fleet_vehicles v where v.id = ${vehicleId}::uuid
      `);
      const cap = limit[0]?.limit_cents ? Number(limit[0].limit_cents) : null;
      if (cap != null && Number(limit[0]?.spent ?? 0) + amount > cap) {
        return { status: "conflict", reason: "El vale supera el límite del vehículo. No se cargó.", body: { amountCents: amount } };
      }
    }
    await tx.execute(sql`
      insert into fleet_vouchers (company_id, customer_id, vehicle_id, driver_id, product_id, liters, amount_cents, issued_on)
      values (${companyId}, ${String(payload.customerId)}::uuid, ${vehicleId}, ${payload.driverId ? String(payload.driverId) : null}, ${String(payload.productId)}::uuid, ${liters}, ${amount}, ${todayIso()}::date)
    `);
    return { status: "applied", body: { amountCents: amount } };
  }
  if (op.kind === "reparto.entrega") {
    if (!isUuid(payload.compartmentId)) throw new HttpError(400, "Elegí el compartimento");
    if (!isUuid(payload.customerId)) throw new HttpError(400, "Elegí el cliente");
    const rows = await tx.execute<{ quantity: string; product_name: string }>(sql`
      select c.quantity::text, p.name as product_name from fuel_compartments c join fuel_products p on p.id = c.product_id
      where c.id = ${String(payload.compartmentId)}::uuid and c.company_id = ${companyId}
    `);
    const row = rows[0];
    if (!row) throw new HttpError(400, "No encontramos el compartimento");
    const delivered = parseInputNumber(payload.liters);
    if (delivered == null || delivered <= 0) throw new HttpError(400, "La cantidad tiene que ser mayor a cero");
    const decision = stockDecision(delivered, Number(row.quantity));
    if (!decision.apply) return { status: "conflict", reason: decision.reason, body: { serverQuantity: Number(row.quantity) } };
    let documentId: string | null = null;
    const document = payload.document === "factura" ? "factura" : "remito";
    const kind = document === "factura" ? "venta" : "remito";
    const moduleKey = kind === "venta" ? "ventas" : "remitos";
    if (can(auth.permissions, moduleKey, "crear") && moduleEnabled(auth.company.enabledModules, moduleKey)) {
      documentId = await issueFuelLine(tx, auth, {
        customerId: String(payload.customerId),
        compartmentId: String(payload.compartmentId),
        liters: delivered,
        description: row.product_name,
        kind,
        code: document === "factura" ? "FAC" : "REM",
      });
    }
    await tx.execute(sql`update fuel_compartments set quantity = quantity - ${delivered} where id = ${String(payload.compartmentId)}::uuid`);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, compartment_id, customer_id, document_id, liters, note)
      values (${companyId}, ${String(payload.tripId)}::uuid, 'entrega', ${String(payload.compartmentId)}::uuid, ${String(payload.customerId)}::uuid, ${documentId}, ${delivered}, ${document})
    `);
    const discrepancy = priceDiscrepancy(payload.clientTotalCents == null ? null : Number(payload.clientTotalCents), Number(payload.serverHintCents ?? payload.clientTotalCents ?? 0));
    if (discrepancy) {
      await tx.execute(sql`
        insert into sync_conflicts (company_id, user_id, op_key, kind, reason)
        values (${companyId}, ${auth.user.id}, ${op.key}, ${op.kind}, ${`El comprobante provisorio decía ${formatMoney(discrepancy.clientCents)} y en el servidor salió ${formatMoney(Number(payload.serverHintCents ?? discrepancy.serverCents))}. Revisalo cuando puedas.`})
      `);
    }
    return { status: "applied", body: { documentId } };
  }
  if (op.kind === "comprobante") {
    const ids = payload.customerId
      ? [String(payload.customerId)]
      : (await tx.execute<{ id: string }>(sql`select distinct customer_id::text as id from fleet_vouchers where company_id = ${companyId} and status = 'abierto'`)).map((row) => row.id);
    if (!ids.length) return { status: "conflict", reason: "No había vales abiertos en el servidor." };
    let total = 0;
    let documentId: string | null = null;
    const notices: string[] = [];
    for (const id of ids) {
      const created = await issueFleet(tx, auth, id, ids.length === 1 && payload.clientTotalCents != null ? Number(payload.clientTotalCents) : null);
      if (!created.documentId) {
        if (created.notice) notices.push(created.notice);
        continue;
      }
      total += created.totalCents;
      documentId = created.documentId;
      if (created.notice) notices.push(created.notice);
    }
    if (!documentId) return { status: "conflict", reason: notices.join(" ") || "No había vales abiertos en el servidor." };
    return { status: "applied", body: { documentId, totalCents: total, notice: notices.join(" ") || null } };
  }
  if (op.kind === "reparto.carga" || op.kind === "reparto.retorno") {
    if (!isUuid(payload.compartmentId)) throw new HttpError(400, "Elegí el compartimento");
    const sign = op.kind === "reparto.carga" ? 1 : -1;
    const moved = parseInputNumber(payload.liters);
    if (moved == null || moved <= 0) throw new HttpError(400, "La cantidad tiene que ser mayor a cero");
    const rows = await tx.execute<{ quantity: string }>(sql`select quantity::text from fuel_compartments where id = ${String(payload.compartmentId)}::uuid and company_id = ${companyId}`);
    const available = op.kind === "reparto.retorno" ? Number(rows[0]?.quantity ?? 0) : Number.POSITIVE_INFINITY;
    const decision = stockDecision(moved, available);
    if (!decision.apply) return { status: "conflict", reason: decision.reason };
    await tx.execute(sql`update fuel_compartments set quantity = quantity + ${sign * moved} where id = ${String(payload.compartmentId)}::uuid`);
    await tx.execute(sql`
      insert into fuel_trip_events (company_id, trip_id, kind, tank_id, compartment_id, liters)
      values (${companyId}, ${String(payload.tripId)}::uuid, ${op.kind === "reparto.carga" ? "carga" : "retorno"}, ${payload.tankId ? String(payload.tankId) : null}, ${String(payload.compartmentId)}::uuid, ${moved})
    `);
    return { status: "applied", body: { saved: true } };
  }
  throw new HttpError(400, "No reconocemos esa operación");
}

async function issueFuelLine(tx: Tx, auth: AuthContext, args: { customerId: string; compartmentId: string; liters: number; description: string; kind: "venta" | "remito"; code: string }) {
  const [dtype] = await tx.execute<{ id: string }>(sql`
    select id::text from document_types where company_id = ${auth.company.companyId} and code = ${args.code} and kind = ${args.kind} and active limit 1
  `);
  const priced = await tx.execute<{ cents: string; iva: number; code: string; taxes: FuelTax[] | null }>(sql`
    select pr.cents_per_unit::text as cents, p.iva_rate_bps as iva, p.code,
      ${sql.raw(CURRENT_FUEL_TAXES_SQL)} as taxes
    from fuel_compartments c
    join fuel_products p on p.id = c.product_id
    join fuel_prices pr on pr.product_id = p.id
    where c.id = ${args.compartmentId}::uuid
    order by pr.valid_from desc limit 1
  `);
  const price = priced[0];
  if (!dtype || !price) return null;
  const draft = fuelSaleDraft({
    description: args.description,
    sku: price.code,
    liters: args.liters,
    pumpPriceCents: Number(price.cents),
    ivaRateBps: price.iva,
    taxes: price.taxes ?? [],
    invoice: true,
  });
  const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
    kind: args.kind,
    documentTypeId: dtype.id,
    partyId: args.customerId,
    issuedOn: todayIso(),
    paymentMethod: "cuenta_corriente",
    otherTaxesCents: draft.otherTaxesCents,
    perceptions: [],
    lines: [draft.line],
  });
  return created.id;
}

async function issueFleet(tx: Tx, auth: AuthContext, customerId: string, clientTotalCents: number | null) {
  const vouchers = await tx.execute<{ id: string; product_id: string; liters: string; amount_cents: string }>(sql`
    select id::text, product_id::text, liters::text, amount_cents::text from fleet_vouchers
    where company_id = ${auth.company.companyId} and status = 'abierto' and customer_id = ${customerId}::uuid
  `);
  if (!vouchers.length) return { documentId: null, totalCents: 0, notice: "No había vales abiertos en el servidor." };
  const [dtype] = await tx.execute<{ id: string }>(sql`
    select id::text from document_types where company_id = ${auth.company.companyId} and code = 'FAC' and kind = 'venta' limit 1
  `);
  if (!dtype) throw new HttpError(400, "Definí una factura de venta");
  let other = 0;
  let expected = 0;
  const lines: { description: string; quantity: number; unitPriceCents: number; discountBps: number; amountCents: number; ivaRateBps: number }[] = [];
  for (const voucher of vouchers) {
    const liters = Number(voucher.liters);
    const gross = Number(voucher.amount_cents);
    if (!(liters > 0) || !(gross > 0)) continue;
    const priced = await tx.execute<{ name: string; iva: number; taxes: FuelTax[] | null }>(sql`
      select p.name, p.iva_rate_bps as iva, ${sql.raw(CURRENT_FUEL_TAXES_SQL)} as taxes
      from fuel_products p where p.id = ${voucher.product_id}::uuid
    `);
    const price = priced[0];
    if (!price) continue;
    const split = splitGrossSale({ quantity: liters, grossCents: gross, ivaRateBps: price.iva, taxes: oneTaxPerCode(price.taxes ?? []) });
    const parts = pumpInvoiceParts(split, price.iva);
    other += parts.otherTaxesCents;
    expected += gross;
    lines.push({
      description: price.name,
      quantity: liters,
      unitPriceCents: Math.max(1, Math.round(gross / liters)),
      discountBps: 0,
      amountCents: parts.netCents,
      ivaRateBps: price.iva,
    });
  }
  if (!lines.length) throw new HttpError(400, "Esos vales no tienen importe");
  const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
    kind: "venta",
    documentTypeId: dtype.id,
    partyId: customerId,
    issuedOn: todayIso(),
    paymentMethod: "cuenta_corriente",
    otherTaxesCents: other,
    perceptions: [],
    lines,
  });
  const ids = sql.join(vouchers.map((voucher) => sql`${voucher.id}::uuid`), sql`, `);
  await tx.execute(sql`update fleet_vouchers set status = 'facturado', document_id = ${created.id}::uuid where id in (${ids})`);
  await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "estacion.flota", entity: "cliente", entityId: customerId, summary: "Facturó vales de flota" });
  const compared = clientTotalCents ?? expected;
  const gap = created.totalCents - compared;
  const notice = gap === 0 ? null : Math.abs(gap) <= 1
    ? `Se facturó. El redondeo movió ${formatMoney(Math.abs(gap))}.`
    : `Se facturó ${formatMoney(created.totalCents)}. Los vales sumaban ${formatMoney(compared)}.`;
  return { documentId: created.id, totalCents: created.totalCents, notice };
}

function isUuid(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
