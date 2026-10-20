import { sql } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/domain/audit";
import { normalizePlate, plateError } from "@/lib/guards";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

const compartment = z.object({
  name: z.string().trim().min(1).max(40),
  productId: z.string().uuid(),
  capacity: z.number().positive(),
});

export async function equipos(method: string, rest: string[], req: Request): Promise<Response> {
  const [area, id] = rest;
  if (method === "GET" && !area) return board();
  if (method === "POST" && area === "camion" && !id) return saveTruck(req, null);
  if (method === "PATCH" && area === "camion" && id) return saveTruck(req, id);
  if (method === "POST" && area === "surtidor" && !id) return savePump(req, null);
  if (method === "PATCH" && area === "surtidor" && id) return savePump(req, id);
  if (method === "POST" && area === "pico" && !id) return saveNozzle(req, null);
  if (method === "PATCH" && area === "pico" && id) return saveNozzle(req, id);
  if (method === "POST" && area === "reinicio") return resetMeter(req);
  if (method === "POST" && area === "tanque" && !id) return saveTank(req, null);
  if (method === "PATCH" && area === "tanque" && id) return saveTank(req, id);
  throw new HttpError(404, "No existe esa ruta");
}

async function board() {
  const auth = await requirePermission("estacion", "editar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const trucks = can(auth.permissions, "reparto", "editar")
      ? await tx.execute(sql`
          select t.id::text, t.plate, t.name, t.description, t.km_initial::text, t.active, t.driver_user_id::text,
            coalesce((select count(*) from fuel_trips v where v.truck_id = t.id), 0)::int as trips
          from fuel_trucks t where t.company_id = ${companyId} order by t.plate
        `)
      : [];
    const compartments = can(auth.permissions, "reparto", "editar")
      ? await tx.execute(sql`
          select c.id::text, c.truck_id::text, c.name, c.product_id::text, p.name as product_name, c.capacity::text, c.quantity::text
          from fuel_compartments c join fuel_products p on p.id = c.product_id
          where c.company_id = ${companyId} order by c.name
        `)
      : [];
    const pumps = await tx.execute(sql`
      select p.id::text, p.number, p.name, p.active,
        coalesce((select count(*) from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id where n.pump_id = p.id), 0)::int as readings
      from fuel_pumps p where p.company_id = ${companyId} order by p.number
    `);
    const nozzles = await tx.execute(sql`
      select n.id::text, n.pump_id::text, n.number, n.product_id::text, n.tank_id::text, fp.name as product_name, t.name as tank_name,
        coalesce((select mr.reading::text from fuel_meter_resets mr where mr.nozzle_id = n.id order by mr.reset_at desc limit 1),
          (select r.closing::text from fuel_readings r join fuel_shifts s on s.id = r.shift_id where r.nozzle_id = n.id and r.closing is not null order by s.opened_at desc limit 1),
          '0') as reading
      from fuel_nozzles n
      join fuel_products fp on fp.id = n.product_id
      join fuel_tanks t on t.id = n.tank_id
      where n.company_id = ${companyId}
      order by n.number
    `);
    const tanks = await tx.execute(sql`
      select t.id::text, t.name, t.product_id::text, p.name as product_name, t.capacity::text, t.active,
        coalesce((select count(*) from fuel_sticks s where s.tank_id = t.id), 0)::int as sticks
      from fuel_tanks t join fuel_products p on p.id = t.product_id
      where t.company_id = ${companyId} order by t.name
    `);
    const sticks = await tx.execute(sql`
      select tank_id::text, measured_at::text, liters::text, note
      from fuel_sticks where company_id = ${companyId} order by measured_at desc limit 40
    `);
    const products = await tx.execute(sql`select id::text, name, unit from fuel_products where company_id = ${companyId} and active order by name`);
    const drivers = await tx.execute(sql`
      select u.id::text, u.name from memberships m
      join users u on u.id = m.user_id
      join roles r on r.id = m.role_id
      where m.company_id = ${companyId} and m.active and r.key in ('chofer', 'encargado')
      order by u.name
    `);
    return ok({
      trucks, compartments, pumps, nozzles, tanks, sticks, products, drivers,
      canTrucks: can(auth.permissions, "reparto", "editar"),
    });
  });
}

async function saveTruck(req: Request, id: string | null) {
  const auth = await requirePermission("reparto", "editar");
  const body = await readBody(req, z.object({
    plate: z.string().trim().min(1).max(12),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(160).optional().default(""),
    driverUserId: z.string().uuid().nullable().optional(),
    kmInitial: z.number().nonnegative().optional().default(0),
    active: z.boolean().optional().default(true),
    compartments: z.array(compartment).max(6).optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const plate = plateError(body.plate);
    if (plate) throw new HttpError(400, plate);
    if (id && body.active === false) {
      const stock = await tx.execute<{ qty: string }>(sql`select coalesce(sum(quantity), 0)::text as qty from fuel_compartments where truck_id = ${id}::uuid and company_id = ${companyId}`);
      if (Number(stock[0]?.qty ?? 0) > 0) throw new HttpError(409, "Ese camión todavía tiene combustible. Vacialo antes de desactivarlo.");
    }
    if (!id && !body.compartments?.length) throw new HttpError(400, "El camión necesita al menos un compartimento");
    if (id && body.compartments?.length) {
      const trips = await tx.execute<{ n: number }>(sql`select count(*)::int as n from fuel_trips where truck_id = ${id}::uuid`);
      if (Number(trips[0]?.n ?? 0) > 0) throw new HttpError(409, "Ese camión ya tiene viajes. Podés cambiar la patente, el chofer y los km, pero no los compartimentos.");
    }
    let truckId = id;
    if (!truckId) {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fuel_trucks (company_id, plate, name, description, driver_user_id, km_initial, active)
        values (${companyId}, ${normalizePlate(body.plate)}, ${body.name}, ${body.description}, ${body.driverUserId ?? null}, ${body.kmInitial}, ${body.active})
        returning id::text
      `);
      truckId = row.id;
    } else {
      await tx.execute(sql`
        update fuel_trucks set plate = ${normalizePlate(body.plate)}, name = ${body.name}, description = ${body.description},
          driver_user_id = ${body.driverUserId ?? null}, km_initial = ${body.kmInitial}, active = ${body.active}
        where id = ${truckId}::uuid and company_id = ${companyId}
      `);
    }
    if (body.compartments?.length) {
      if (id) await tx.execute(sql`delete from fuel_compartments where truck_id = ${truckId}::uuid and company_id = ${companyId}`);
      for (const item of body.compartments) {
        await tx.execute(sql`
          insert into fuel_compartments (company_id, truck_id, product_id, name, capacity, quantity)
          values (${companyId}, ${truckId}::uuid, ${item.productId}::uuid, ${item.name}, ${item.capacity}, 0)
        `);
      }
    }
    await writeAudit(tx, { companyId, userId: auth.user.id, action: "reparto.camion", entity: "camion", entityId: truckId, summary: `${id ? "Editó" : "Alta de"} el camión ${normalizePlate(body.plate)}` });
    return ok({ id: truckId });
  });
}

async function savePump(req: Request, id: string | null) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({
    number: z.number().int().positive().max(99),
    name: z.string().trim().min(1).max(80),
    active: z.boolean().optional().default(true),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    if (!id) {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fuel_pumps (company_id, number, name, active)
        values (${auth.company.companyId}, ${body.number}, ${body.name}, ${body.active})
        returning id::text
      `);
      return ok({ id: row.id });
    }
    const readings = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from fuel_readings r join fuel_nozzles n on n.id = r.nozzle_id where n.pump_id = ${id}::uuid
    `);
    if (!body.active && Number(readings[0]?.n ?? 0) === 0) {
      await tx.execute(sql`delete from fuel_nozzles where pump_id = ${id}::uuid and company_id = ${auth.company.companyId}`);
      await tx.execute(sql`delete from fuel_pumps where id = ${id}::uuid and company_id = ${auth.company.companyId}`);
      return ok({ deleted: true });
    }
    await tx.execute(sql`
      update fuel_pumps set number = ${body.number}, name = ${body.name}, active = ${body.active}
      where id = ${id}::uuid and company_id = ${auth.company.companyId}
    `);
    return ok({ id });
  });
}

async function saveNozzle(req: Request, id: string | null) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({
    pumpId: z.string().uuid(),
    number: z.number().int().positive().max(12),
    productId: z.string().uuid(),
    tankId: z.string().uuid(),
    opening: z.number().nonnegative().optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const tank = await tx.execute<{ product_id: string }>(sql`
      select product_id::text from fuel_tanks where id = ${body.tankId}::uuid and company_id = ${companyId}
    `);
    if (!tank[0]) throw new HttpError(400, "Elegí un tanque de esta estación");
    if (tank[0].product_id !== body.productId) throw new HttpError(400, "El combustible del pico tiene que ser el mismo que el del tanque");
    const taken = await tx.execute<{ id: string }>(sql`
      select id::text from fuel_nozzles
      where pump_id = ${body.pumpId}::uuid and number = ${body.number} and company_id = ${companyId}
        and (${id}::uuid is null or id <> ${id}::uuid)
    `);
    if (taken[0]) throw new HttpError(409, "Ya hay un pico con ese número en el surtidor");
    if (!id) {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fuel_nozzles (company_id, pump_id, tank_id, product_id, number)
        values (${companyId}, ${body.pumpId}::uuid, ${body.tankId}::uuid, ${body.productId}::uuid, ${body.number})
        returning id::text
      `);
      await tx.execute(sql`
        insert into fuel_meter_resets (company_id, nozzle_id, reading, note)
        values (${companyId}, ${row.id}::uuid, ${body.opening ?? 0}, 'Lectura inicial')
      `);
      return ok({ id: row.id });
    }
    await tx.execute(sql`
      update fuel_nozzles set pump_id = ${body.pumpId}::uuid, tank_id = ${body.tankId}::uuid, product_id = ${body.productId}::uuid, number = ${body.number}
      where id = ${id}::uuid and company_id = ${companyId}
    `);
    return ok({ id });
  });
}

async function resetMeter(req: Request) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({
    nozzleId: z.string().uuid(),
    reading: z.number().nonnegative(),
    resetAt: z.string().optional(),
    note: z.string().trim().max(120).optional().default("Cambio de aforador"),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await tx.execute(sql`
      insert into fuel_meter_resets (company_id, nozzle_id, reading, reset_at, note)
      values (${auth.company.companyId}, ${body.nozzleId}::uuid, ${body.reading}, coalesce(${body.resetAt ?? null}::timestamptz, now()), ${body.note})
    `);
    return ok({ saved: true });
  });
}

async function saveTank(req: Request, id: string | null) {
  const auth = await requirePermission("estacion", "editar");
  const body = await readBody(req, z.object({
    name: z.string().trim().min(1).max(80),
    productId: z.string().uuid(),
    capacity: z.number().positive(),
    active: z.boolean().optional().default(true),
    initialLiters: z.number().nonnegative().optional(),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    if (body.initialLiters != null && body.initialLiters > body.capacity) {
      throw new HttpError(400, "La varilla inicial no puede superar la capacidad del tanque");
    }
    const sameName = await tx.execute<{ id: string }>(sql`
      select id::text from fuel_tanks
      where company_id = ${companyId} and lower(btrim(name)) = lower(btrim(${body.name}))
        and (${id}::uuid is null or id <> ${id}::uuid)
    `);
    if (sameName[0]) throw new HttpError(409, "Ya hay un tanque con ese nombre");
    if (!id) {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fuel_tanks (company_id, product_id, name, capacity, active)
        values (${companyId}, ${body.productId}::uuid, ${body.name}, ${body.capacity}, ${body.active})
        returning id::text
      `);
      if (body.initialLiters != null) {
        await tx.execute(sql`
          insert into fuel_sticks (company_id, tank_id, liters, note, user_id)
          values (${companyId}, ${row.id}::uuid, ${body.initialLiters}, 'Varilla inicial', ${auth.user.id})
        `);
      }
      return ok({ id: row.id });
    }
    const history = await tx.execute<{ n: number }>(sql`
      select (select count(*) from fuel_sticks where tank_id = ${id}::uuid) + (select count(*) from fuel_deliveries where tank_id = ${id}::uuid) as n
    `);
    if (Number(history[0]?.n ?? 0) > 0) {
      await tx.execute(sql`
        update fuel_tanks set name = ${body.name}, capacity = ${body.capacity}, active = ${body.active}
        where id = ${id}::uuid and company_id = ${companyId}
      `);
    } else {
      await tx.execute(sql`
        update fuel_tanks set name = ${body.name}, product_id = ${body.productId}::uuid, capacity = ${body.capacity}, active = ${body.active}
        where id = ${id}::uuid and company_id = ${companyId}
      `);
    }
    return ok({ id });
  });
}
