import postgres from "postgres";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { commitRows, type CommitRow } from "./exchange-commit";
import { fillIva } from "@/lib/io/validate";
import type { EntityKey } from "@/lib/io/fields";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

function adminSql() {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new HttpError(500, "Falta DATABASE_URL_ADMIN para armar la empresa de ensayo");
  return postgres(url, { max: 1, onnotice: () => {} });
}

export async function migracion(method: string, path: string[], req: Request): Promise<Response> {
  const area = path[1];
  if (method === "POST" && area === "ensayo") return ensayo(req);
  if (method === "GET" && area === "comparar") return comparar(new URL(req.url));
  if (method === "POST" && area === "promover") return promover(req);
  if (method === "POST" && area === "borrar") return borrar(req);
  if (method === "POST" && area === "saldos") return saldos(req);
  if (method === "POST" && area === "paralelo") return paralelo(req);
  throw new HttpError(404, "No existe esa ruta");
}

async function ensayo(req: Request) {
  const auth = await requirePermission("configuracion", "editar");
  const body = await readBody(req, z.object({ jobId: z.string().uuid() }));
  const loaded = await withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const jobs = await tx.execute<{ id: string; entity: string; status: string }>(sql`select id::text, entity, status from import_jobs where id = ${body.jobId} and company_id = ${auth.company.companyId}`);
    const job = jobs[0];
    if (!job || job.status === "deshecho") throw new HttpError(400, "Esa importación no está para ensayar");
    const rows = await tx.execute<{ row_number: number; raw: Record<string, string>; values: Record<string, string>; errors: string[]; duplicate: boolean; row_key: string }>(sql`
      select row_number, raw, values, errors, duplicate, row_key from import_rows where job_id = ${body.jobId} order by row_number
    `);
    return { job, rows };
  });
  const db = adminSql();
  try {
    const [sandbox] = await db<{ id: string }[]>`
      insert into companies (slug, name, legal_name, cuit, tax_condition, point_of_sale, enabled_modules, block_negative_stock, sandbox_of)
      select ${`ensayo-${Date.now()}`}, name || ' (ensayo)', legal_name, cuit, tax_condition, point_of_sale, enabled_modules, true, id
      from companies where id = ${auth.company.companyId}
      returning id
    `;
    await db`insert into roles (company_id, key, name, description, is_system) select ${sandbox.id}, key, name, description, true from roles where company_id = ${auth.company.companyId}`;
    await db`
      insert into role_permissions (role_id, permission)
      select n.id, p.permission from roles n
      join roles o on o.company_id = ${auth.company.companyId} and o.key = n.key
      join role_permissions p on p.role_id = o.id
      where n.company_id = ${sandbox.id}
    `;
    const [role] = await db<{ id: string }[]>`select id from roles where company_id = ${sandbox.id} and key = 'admin'`;
    await db`insert into memberships (user_id, company_id, role_id) values (${auth.user.id}, ${sandbox.id}, ${role.id})`;
    await db`insert into document_types (company_id, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes)
      select ${sandbox.id}, code, name, kind, sign, moves_stock, stock_factor, moves_account, account_side, moves_cash, cash_direction, moves_vat, afip_codes from document_types where company_id = ${auth.company.companyId}`;
    await db`insert into warehouses (company_id, name, is_default) select ${sandbox.id}, name, is_default from warehouses where company_id = ${auth.company.companyId}`;
    await db`insert into cash_accounts (company_id, name, kind, active) select ${sandbox.id}, name, kind, active from cash_accounts where company_id = ${auth.company.companyId}`;
    await db`insert into price_lists (company_id, name, is_default) select ${sandbox.id}, name, is_default from price_lists where company_id = ${auth.company.companyId}`;
    const summary = await withTenant(sandbox.id, auth.user.id, async (tx) => applyRows(tx, sandbox.id, auth.user.id, auth.company.pointOfSale, loaded.job.entity, loaded.rows));
    const compare = { real: await totals(db, auth.company.companyId), sandbox: await totals(db, sandbox.id) };
    return ok({ sandboxId: sandbox.id, summary, compare });
  } finally {
    await db.end();
  }
}

async function applyRows(tx: Tx, companyId: string, userId: string, pointOfSale: number, entityName: string, rows: { row_number: number; raw: Record<string, string>; values: Record<string, string>; errors: string[]; duplicate: boolean; row_key: string }[]) {
  const groups = new Map<EntityKey, CommitRow[]>();
  for (const row of rows) {
    const entity = ((row.raw?._entidad as string) || entityName) as EntityKey;
    if ((entity as string) === "saldos") continue;
    const values = fillIva(row.values, "regla");
    const bucket = groups.get(entity) ?? [];
    bucket.push({ rowNumber: row.row_number, values, errors: row.errors ?? [], duplicate: row.duplicate, missingIva: false, rowKey: row.row_key });
    groups.set(entity, bucket);
  }
  const summary = { created: 0, updated: 0, skipped: 0, failed: 0 };
  for (const [entity, bucket] of groups) {
    const part = await commitRows(tx, { companyId, userId, pointOfSale }, entity, bucket, { duplicateMode: "omitir", afectaCuenta: false });
    summary.created += part.summary.created;
    summary.updated += part.summary.updated;
    summary.skipped += part.summary.skipped;
    summary.failed += part.summary.failed;
  }
  return summary;
}

async function totals(db: ReturnType<typeof adminSql>, companyId: string) {
  const [row] = await db<{ clientes: string; ventas: string; compras: string; stock: string }[]>`
    select
      (select count(*) from customers where company_id = ${companyId})::text as clientes,
      (select coalesce(sum(total_cents), 0) from documents where company_id = ${companyId} and kind = 'venta' and status = 'confirmado')::text as ventas,
      (select coalesce(sum(total_cents), 0) from documents where company_id = ${companyId} and kind = 'compra' and status = 'confirmado')::text as compras,
      (select coalesce(sum(quantity), 0) from stock_levels where company_id = ${companyId})::text as stock
  `;
  return row;
}

async function comparar(url: URL) {
  const auth = await requirePermission("configuracion", "ver");
  const sandboxId = url.searchParams.get("sandbox");
  if (!sandboxId) throw new HttpError(400, "Falta la empresa de ensayo");
  const db = adminSql();
  try {
    return ok({ real: await totals(db, auth.company.companyId), sandbox: await totals(db, sandboxId) });
  } finally {
    await db.end();
  }
}

async function promover(req: Request) {
  const auth = await requirePermission("configuracion", "editar");
  const body = await readBody(req, z.object({ jobId: z.string().uuid() }));
  const loaded = await withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const jobs = await tx.execute<{ entity: string; status: string }>(sql`select entity, status from import_jobs where id = ${body.jobId} and company_id = ${auth.company.companyId}`);
    if (!jobs[0] || jobs[0].status !== "analizado") throw new HttpError(400, "Confirmá desde el ensayo solo si la importación sigue en vista previa. Si ya la confirmaste, usá Deshacer.");
    const rows = await tx.execute<{ row_number: number; raw: Record<string, string>; values: Record<string, string>; errors: string[]; duplicate: boolean; row_key: string }>(sql`
      select row_number, raw, values, errors, duplicate, row_key from import_rows where job_id = ${body.jobId} order by row_number
    `);
    return { entity: jobs[0].entity, rows };
  });
  const summary = await withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const result = await applyRows(tx, auth.company.companyId, auth.user.id, auth.company.pointOfSale, loaded.entity, loaded.rows);
    await tx.execute(sql`update import_jobs set status = 'importado', summary = ${JSON.stringify(result)}::jsonb where id = ${body.jobId}`);
    return result;
  });
  return ok({ promoted: true, summary });
}

async function borrar(req: Request) {
  const auth = await requirePermission("configuracion", "editar");
  const body = await readBody(req, z.object({ sandboxId: z.string().uuid() }));
  const db = adminSql();
  try {
    const removed = await db`delete from companies where id = ${body.sandboxId} and sandbox_of = ${auth.company.companyId} returning id`;
    if (!removed.length) throw new HttpError(404, "Ese ensayo no es de esta empresa");
    return ok({ deleted: true });
  } finally {
    await db.end();
  }
}

async function saldos(req: Request) {
  const auth = await requirePermission("configuracion", "editar");
  const body = await readBody(req, z.object({
    fecha: z.string(),
    filas: z.array(z.object({
      tipo: z.enum(["cliente", "proveedor", "stock", "tanque", "caja", "banco"]),
      codigo: z.string().min(1),
      importeCents: z.number().int().optional(),
      cantidad: z.number().optional(),
    })).max(500),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    let applied = 0;
    for (const row of body.filas) {
      if (row.tipo === "cliente" || row.tipo === "proveedor") {
        const table = row.tipo === "cliente" ? "customers" : "suppliers";
        const found = await tx.execute<{ id: string }>(sql`select id::text from ${sql.raw(table)} where company_id = ${auth.company.companyId} and code = ${row.codigo}`);
        if (!found[0]) continue;
        const amount = row.importeCents ?? 0;
        await tx.execute(sql`
          insert into current_account_entries (company_id, party_type, party_id, occurred_on, description, debit_cents, credit_cents)
          values (${auth.company.companyId}, ${row.tipo === "cliente" ? "customer" : "supplier"}, ${found[0].id}::uuid, ${body.fecha}::date, 'Saldo inicial',
            ${row.tipo === "cliente" ? amount : 0}, ${row.tipo === "proveedor" ? amount : 0})
        `);
        applied += 1;
      } else if (row.tipo === "caja" || row.tipo === "banco") {
        const caja = await tx.execute<{ id: string; active: boolean }>(sql`
          select id::text, active from cash_accounts
          where company_id = ${auth.company.companyId}
            and (name = ${row.codigo} or (${row.tipo} = 'caja' and kind = 'caja' and name ilike ${row.codigo}))
          order by (name = ${row.codigo}) desc, active desc
          limit 1
        `);
        if (!caja[0]) continue;
        if (!caja[0].active) throw new HttpError(409, "Esa caja está cerrada. Abrila para cargar el saldo inicial.");
        await tx.execute(sql`
          insert into cash_movements (company_id, cash_account_id, direction, amount_cents, description, occurred_on, created_by)
          values (${auth.company.companyId}, ${caja[0].id}::uuid, 'in', ${row.importeCents ?? 0}, 'Saldo inicial de caja', ${body.fecha}::date, ${auth.user.id})
        `);
        applied += 1;
      } else if (row.tipo === "stock") {
        const product = await tx.execute<{ id: string }>(sql`select id::text from products where company_id = ${auth.company.companyId} and sku = ${row.codigo}`);
        const depot = await tx.execute<{ id: string }>(sql`select id::text from warehouses where company_id = ${auth.company.companyId} and is_default limit 1`);
        if (!product[0] || !depot[0]) continue;
        await tx.execute(sql`
          insert into stock_levels (product_id, warehouse_id, company_id, quantity)
          values (${product[0].id}::uuid, ${depot[0].id}::uuid, ${auth.company.companyId}, ${row.cantidad ?? 0})
          on conflict (product_id, warehouse_id) do update set quantity = excluded.quantity
        `);
        applied += 1;
      } else if (row.tipo === "tanque") {
        const tank = await tx.execute<{ id: string }>(sql`select id::text from fuel_tanks where company_id = ${auth.company.companyId} and name = ${row.codigo}`);
        if (!tank[0]) continue;
        await tx.execute(sql`insert into fuel_sticks (company_id, tank_id, liters, note) values (${auth.company.companyId}, ${tank[0].id}::uuid, ${row.cantidad ?? 0}, 'Varilla inicial')`);
        applied += 1;
      }
    }
    return ok({ applied });
  });
}

async function paralelo(req: Request) {
  const auth = await requirePermission("informes", "ver");
  const body = await readBody(req, z.object({
    filas: z.array(z.object({
      desde: z.string(),
      hasta: z.string(),
      ventas: z.number(),
      compras: z.number(),
      ivaVentas: z.number(),
      ivaCompras: z.number(),
    })).max(36),
  }));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const rows = [];
    for (const row of body.filas) {
      const talon = await tx.execute<{ ventas: string; compras: string; iva_ventas: string; iva_compras: string }>(sql`
        select
          coalesce(sum(total_cents) filter (where kind = 'venta'), 0)::text as ventas,
          coalesce(sum(total_cents) filter (where kind = 'compra'), 0)::text as compras,
          coalesce(sum(vat_cents) filter (where kind = 'venta'), 0)::text as iva_ventas,
          coalesce(sum(vat_cents) filter (where kind = 'compra'), 0)::text as iva_compras
        from documents
        where company_id = ${auth.company.companyId} and status = 'confirmado' and issued_on between ${row.desde}::date and ${row.hasta}::date
      `);
      const got = talon[0];
      rows.push({
        desde: row.desde,
        hasta: row.hasta,
        ventas: { talon: Number(got?.ventas ?? 0), anterior: row.ventas, diferencia: Number(got?.ventas ?? 0) - row.ventas },
        compras: { talon: Number(got?.compras ?? 0), anterior: row.compras, diferencia: Number(got?.compras ?? 0) - row.compras },
        ivaVentas: { talon: Number(got?.iva_ventas ?? 0), anterior: row.ivaVentas, diferencia: Number(got?.iva_ventas ?? 0) - row.ivaVentas },
        ivaCompras: { talon: Number(got?.iva_compras ?? 0), anterior: row.ivaCompras, diferencia: Number(got?.iva_compras ?? 0) - row.ivaCompras },
      });
    }
    return ok({ rows });
  });
}
