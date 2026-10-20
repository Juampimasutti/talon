import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { can, moduleEnabled } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/session";
import { getAuth, requirePermission } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import {
  customFieldDefs,
  customFieldValues,
  customers,
  documentTypes,
  documents,
  ledgerAccounts,
  products,
  stockLevels,
  suppliers,
  warehouses,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/domain/audit";
import { ENTITIES, FIELDS, autoMap, detectProfile, entityModule, exampleColumns, exampleRows, normalizeHeader, type EntityKey } from "@/lib/io/fields";
import { readWorkbook, writeWorkbook } from "@/lib/io/excel";
import { parseDelimited, parseFixedWidth, parseWidths, toDelimited, type ParsedSheet } from "@/lib/io/parse";
import { fillIva, reviewRow, type ReviewedRow } from "@/lib/io/validate";
import { HttpError, likeTerm, ok } from "@/lib/http";
import type { TaxCondition } from "@/lib/fiscal/letter";
import { commitRows, undoOps, type CommitRow } from "./exchange-commit";

const BATCH = 400;

export async function exchange(method: string, path: string[], req: Request): Promise<Response> {
  const [root, id, action] = path;
  const url = new URL(req.url);
  if (root === "importar" && method === "GET" && id === "entidades") return entities();
  if (root === "importar" && method === "GET" && id === "plantilla" && action) return templateFile(action, url);
  if (root === "importar" && method === "GET" && id === "trabajos" && !action) return listJobs();
  if (root === "importar" && method === "GET" && id === "trabajos" && action) return jobPreview(action, url);
  if (root === "importar" && method === "POST" && id === "analizar") return analyze(req);
  if (root === "importar" && method === "POST" && id === "trabajos" && path[3] === "mapear") return remap(action, req);
  if (root === "importar" && method === "POST" && id === "trabajos" && path[3] === "confirmar") return confirm(action, req);
  if (root === "importar" && method === "POST" && id === "trabajos" && path[3] === "deshacer") return undo(action);
  if (root === "importar" && method === "POST" && id === "plantillas") return saveTemplate(req);
  if (root === "exportar" && method === "GET" && id) return download(id, url);
  throw new HttpError(404, "No existe esa ruta");
}

async function entities() {
  const auth = await needUser();
  const visible = ENTITIES.filter((entity) => allowed(auth, entity.key, "importar") || allowed(auth, entity.key, "exportar"));
  return ok({
    entities: visible.map((entity) => ({
      ...entity,
      canImport: allowed(auth, entity.key, "importar"),
      canExport: allowed(auth, entity.key, "exportar"),
    })),
    canBackup: can(auth.permissions, "configuracion", "exportar"),
    canRestore: can(auth.permissions, "configuracion", "importar"),
  });
}

function allowed(auth: AuthContext, entity: string, action: "importar" | "exportar"): boolean {
  if (entity === "backup") return can(auth.permissions, "configuracion", action);
  const found = ENTITIES.find((item) => item.key === entity);
  if (!found) return false;
  return moduleEnabled(auth.company.enabledModules, found.module) && can(auth.permissions, found.module, action);
}

async function needUser() {
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
  return auth;
}

function guard(auth: AuthContext, entity: string, action: "importar" | "exportar") {
  if (allowed(auth, entity, action)) return;
  const found = ENTITIES.find((item) => item.key === entity);
  if (found && !moduleEnabled(auth.company.enabledModules, found.module)) {
    throw new HttpError(403, "Ese listado no está activo en esta empresa");
  }
  throw new HttpError(403, "No tenés permiso para hacer eso");
}

async function analyze(req: Request) {
  const auth = await needUser();
  const form = await req.formData();
  const file = form.get("file");
  const entity = String(form.get("entity") ?? "");
  if (!(file instanceof File)) throw new HttpError(400, "Falta el archivo");
  if (file.size > 15_000_000) throw new HttpError(400, "El archivo supera los 15 MB");
  guard(auth, entity === "backup" ? "backup" : entity, "importar");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sheets = await readSheets(file.name, buffer, String(form.get("delimiter") ?? "auto"), String(form.get("widths") ?? ""), form.get("header") !== "0");
  const selected = entity === "backup" ? sheets.flatMap((sheet) => tagSheet(sheet)) : sheets.slice(0, 1).map((sheet) => ({ ...sheet, entity: entity as EntityKey }));
  if (selected.length === 0 || selected.every((sheet) => sheet.rows.length === 0)) throw new HttpError(400, "El archivo no tiene filas");

  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const extras = await tx.select().from(customFieldDefs).where(eq(customFieldDefs.companyId, auth.company.companyId));
    const extraLabels = extras.map((field) => ({ key: `campo:${field.id}`, label: field.label }));
    const first = selected[0];
    const profile = detectProfile(first.columns);
    const mapping = entity === "backup" ? {} : autoMap(first.columns, first.entity, extraLabels);
    const existing = await existingKeys(tx, auth.company.companyId, first.entity);
    const reviewed: { sheet: EntityKey; columns: string[]; row: string[]; result: ReviewedRow; index: number }[] = [];
    const seen = new Set<string>();
    for (const sheet of selected) {
      const sheetMapping = entity === "backup" ? autoMap(sheet.columns, sheet.entity, extraLabels) : mapping;
      const keys = entity === "backup" ? await existingKeys(tx, auth.company.companyId, sheet.entity) : existing;
      for (const key of keys) existing.add(key);
      sheet.rows.forEach((row) => {
        const result = reviewRow({ entity: sheet.entity, columns: sheet.columns, row, mapping: sheetMapping, seen, existing });
        reviewed.push({ sheet: sheet.entity, columns: sheet.columns, row, result, index: reviewed.length });
      });
    }
    const summary = summarize(reviewed.map((item) => item.result));
    await tx.execute(sql`
      update import_jobs set status = 'descartado'
      where company_id = ${auth.company.companyId} and status = 'analizado' and created_at < now() - interval '1 day'
    `);
    const pending = await tx.execute<{ id: string }>(sql`
      select id::text from import_jobs
      where company_id = ${auth.company.companyId} and entity = ${entity} and filename = ${file.name} and status = 'analizado'
      order by created_at desc limit 1
    `);
    let jobId = pending[0]?.id;
    if (jobId) {
      await tx.execute(sql`delete from import_rows where job_id = ${jobId}::uuid`);
      await tx.execute(sql`
        update import_jobs
        set columns = ${JSON.stringify(first.columns)}::jsonb,
            mapping = ${JSON.stringify(mapping)}::jsonb,
            summary = ${JSON.stringify({ ...summary, profile })}::jsonb,
            created_at = now()
        where id = ${jobId}::uuid
      `);
    } else {
      const [job] = await tx.execute<{ id: string }>(sql`
        insert into import_jobs (company_id, user_id, entity, filename, status, columns, mapping, summary)
        values (${auth.company.companyId}, ${auth.user.id}, ${entity}, ${file.name}, 'analizado', ${JSON.stringify(first.columns)}::jsonb, ${JSON.stringify(mapping)}::jsonb, ${JSON.stringify({ ...summary, profile })}::jsonb)
        returning id
      `);
      jobId = job.id;
    }
    const job = { id: jobId };
    for (let offset = 0; offset < reviewed.length; offset += BATCH) {
      const chunk = reviewed.slice(offset, offset + BATCH);
      if (chunk.length === 0) continue;
      const values = chunk.map((item) => {
        const raw = Object.fromEntries(item.columns.map((column, columnIndex) => [column, item.row[columnIndex] ?? ""]));
        return sql`(${job.id}::uuid, ${item.index + 2}, ${JSON.stringify({ ...raw, _entidad: item.sheet })}::jsonb, ${JSON.stringify(item.result.values)}::jsonb, ${JSON.stringify(item.result.errors)}::jsonb, ${JSON.stringify(item.result.warnings)}::jsonb, ${item.result.duplicate}, ${item.result.missingIva}, ${item.result.key})`;
      });
      await tx.execute(sql`
        insert into import_rows (job_id, row_number, raw, values, errors, warnings, duplicate, missing_iva, row_key)
        values ${sql.join(values, sql`, `)}
      `);
    }
    const templates = await tx.execute<{ id: string; name: string; mapping: Record<string, string> }>(sql`
      select id, name, mapping from import_templates where company_id = ${auth.company.companyId} and entity = ${entity}
    `);
    return ok({
      jobId: job.id,
      columns: first.columns,
      mapping,
      profile,
      summary,
      fields: fieldChoices(first.entity, extraLabels),
      templates,
      preview: reviewed.slice(0, 80).map((item) => previewOf(item.index + 2, item.result)),
    });
  });
}

async function remap(jobId: string, req: Request) {
  const auth = await needUser();
  const body = (await req.json()) as { mapping: Record<string, string>; saveAs?: string };
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const job = await oneJob(tx, auth.company.companyId, jobId);
    guard(auth, job.entity, "importar");
    const rows = await tx.execute<{ row_number: number; raw: Record<string, string> }>(sql`
      select row_number, raw from import_rows where job_id = ${jobId} order by row_number
    `);
    const columns = (job.columns as string[]) ?? Object.keys(rows[0]?.raw ?? {}).filter((key) => key !== "_entidad");
    const existing = await existingKeys(tx, auth.company.companyId, job.entity as EntityKey);
    const seen = new Set<string>();
    for (const row of rows) {
      const entity = (row.raw._entidad as EntityKey) || (job.entity as EntityKey);
      const record = columns.map((column) => row.raw[column] ?? "");
      const result = reviewRow({ entity, columns, row: record, mapping: body.mapping, seen, existing });
      await tx.execute(sql`
        update import_rows
        set values = ${JSON.stringify(result.values)}::jsonb,
            errors = ${JSON.stringify(result.errors)}::jsonb,
            warnings = ${JSON.stringify(result.warnings)}::jsonb,
            duplicate = ${result.duplicate},
            missing_iva = ${result.missingIva},
            row_key = ${result.key}
        where job_id = ${jobId} and row_number = ${row.row_number}
      `);
    }
    const summary = await summaryOf(tx, jobId);
    await tx.execute(sql`update import_jobs set mapping = ${JSON.stringify(body.mapping)}::jsonb, summary = ${JSON.stringify(summary)}::jsonb where id = ${jobId}`);
    if (body.saveAs) {
      await tx.execute(sql`
        insert into import_templates (company_id, entity, name, mapping)
        values (${auth.company.companyId}, ${job.entity}, ${body.saveAs}, ${JSON.stringify(body.mapping)}::jsonb)
        on conflict (company_id, entity, name) do update set mapping = excluded.mapping
      `);
    }
    const preview = await previewRows(tx, jobId);
    return ok({ summary, preview });
  });
}

async function confirm(jobId: string, req: Request) {
  const auth = await needUser();
  const body = (await req.json()) as { duplicateMode?: "omitir" | "actualizar" | "crear"; ivaMode?: "manual" | "regla" | "bloque"; ivaBloque?: TaxCondition; afectaCuenta?: boolean };
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const job = await oneJob(tx, auth.company.companyId, jobId);
    if (job.status !== "analizado") throw new HttpError(400, "Esta importación ya se confirmó o se deshizo");
    guard(auth, job.entity, "importar");
    const stored = await tx.execute<{ row_number: number; raw: Record<string, string>; values: Record<string, string>; errors: string[]; duplicate: boolean; missing_iva: boolean; row_key: string }>(sql`
      select row_number, raw, values, errors, duplicate, missing_iva, row_key from import_rows where job_id = ${jobId} order by row_number
    `);
    const groups = new Map<EntityKey, CommitRow[]>();
    for (const row of stored) {
      const entity = ((row.raw._entidad as EntityKey) || job.entity) as EntityKey;
      const values = fillIva(row.values, body.ivaMode ?? "manual", body.ivaBloque);
      const missing = (entity === "clientes" || entity === "proveedores") && !values.condicion_iva;
      const errors = [...(row.errors ?? [])];
      if (missing) errors.push("Falta la condición frente al IVA.");
      const bucket = groups.get(entity) ?? [];
      bucket.push({ rowNumber: row.row_number, values, errors, duplicate: row.duplicate, missingIva: missing, rowKey: row.row_key });
      groups.set(entity, bucket);
    }
    const order: EntityKey[] = ["plan", "clientes", "proveedores", "articulos", "listas", "stock", "ventas", "compras"];
    const summary = { created: 0, updated: 0, skipped: 0, failed: 0, messages: [] as string[] };
    for (const entity of order) {
      const bucket = groups.get(entity);
      if (!bucket) continue;
      const { results, summary: part } = await commitRows(tx, { companyId: auth.company.companyId, userId: auth.user.id, pointOfSale: auth.company.pointOfSale }, entity, bucket, {
        duplicateMode: body.duplicateMode ?? "omitir",
        afectaCuenta: Boolean(body.afectaCuenta),
      });
      summary.created += part.created;
      summary.updated += part.updated;
      summary.skipped += part.skipped;
      summary.failed += part.failed;
      summary.messages.push(...part.messages);
      for (const [rowNumber, result] of results) {
        if (result.error) {
          await tx.execute(sql`
            update import_rows set action = ${result.action}, undo = ${JSON.stringify(result.undo)}::jsonb, errors = ${JSON.stringify([result.error])}::jsonb
            where job_id = ${jobId} and row_number = ${rowNumber}
          `);
        } else {
          await tx.execute(sql`
            update import_rows set action = ${result.action}, undo = ${JSON.stringify(result.undo)}::jsonb
            where job_id = ${jobId} and row_number = ${rowNumber}
          `);
        }
      }
    }
    if (summary.messages.length > 80) {
      const extra = summary.messages.length - 80;
      summary.messages = [...summary.messages.slice(0, 80), `Y ${extra} filas más.`];
    }
    await tx.execute(sql`update import_jobs set status = 'importado', summary = ${JSON.stringify(summary)}::jsonb where id = ${jobId}`);
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "importar.confirmar",
      entity: job.entity,
      entityId: jobId,
      summary: `Importó ${job.filename}: ${summary.created} altas, ${summary.updated} actualizaciones, ${summary.skipped} omitidas, ${summary.failed} con error`,
    });
    return ok(summary);
  });
}

async function undo(jobId: string) {
  const auth = await needUser();
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const job = await oneJob(tx, auth.company.companyId, jobId);
    if (job.status !== "importado") throw new HttpError(400, "Solo se puede deshacer una importación confirmada");
    const ownJob = job.user_id === auth.user.id;
    const admin = can(auth.permissions, "configuracion", "editar");
    if (!ownJob && !admin) throw new HttpError(403, "Solo quien importó, o administración, puede deshacer");
    guard(auth, job.entity, "importar");
    const rows = await tx.execute<{ undo: { op: string; table?: string; id?: string; before?: Record<string, unknown>; productId?: string; warehouseId?: string }[] }>(sql`
      select undo from import_rows where job_id = ${jobId} and action in ('creado', 'actualizado') order by row_number desc
    `);
    for (const row of rows) {
      await undoOps(tx, { companyId: auth.company.companyId, userId: auth.user.id }, row.undo as never);
    }
    await tx.execute(sql`update import_jobs set status = 'deshecho' where id = ${jobId}`);
    await tx.execute(sql`update import_rows set action = 'deshecho' where job_id = ${jobId} and action in ('creado', 'actualizado')`);
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "importar.deshacer",
      entity: job.entity,
      entityId: jobId,
      summary: `Deshizo la importación ${job.filename}`,
    });
    return ok({ status: "deshecho" });
  });
}

async function listJobs() {
  const auth = await needUser();
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await tx.execute(sql`
      update import_jobs set status = 'descartado'
      where company_id = ${auth.company.companyId} and status = 'analizado' and created_at < now() - interval '1 day'
    `);
    const admin = can(auth.permissions, "configuracion", "editar");
    const jobs = await tx.execute<{ id: string; entity: string; filename: string; status: string; summary: unknown; created_at: string; user_id: string }>(sql`
      select id, entity, filename, status, summary, created_at, user_id::text
      from import_jobs
      where company_id = ${auth.company.companyId}
        and status <> 'descartado'
        and (${admin} or user_id = ${auth.user.id})
      order by created_at desc
      limit 20
    `);
    return ok({ jobs });
  });
}

async function jobPreview(jobId: string, url: URL) {
  const auth = await needUser();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const job = await oneJob(tx, auth.company.companyId, jobId);
    const preview = await previewRows(tx, jobId, page);
    return ok({ job, preview });
  });
}

async function saveTemplate(req: Request) {
  const auth = await needUser();
  const body = (await req.json()) as { entity: string; name: string; mapping: Record<string, string> };
  guard(auth, body.entity, "importar");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    await tx.execute(sql`
      insert into import_templates (company_id, entity, name, mapping)
      values (${auth.company.companyId}, ${body.entity}, ${body.name}, ${JSON.stringify(body.mapping)}::jsonb)
      on conflict (company_id, entity, name) do update set mapping = excluded.mapping
    `);
    return ok({ saved: true });
  });
}

async function templateFile(entityName: string, url: URL) {
  const auth = await needUser();
  if (!isEntity(entityName)) throw new HttpError(404, "No conocemos esa planilla");
  guard(auth, entityName, "importar");
  const formato = url.searchParams.get("formato") ?? "csv";
  return fileResponse(formato, entityName, exampleColumns(entityName), exampleRows(entityName), `plantilla-${entityName}`);
}

async function download(entityName: string, url: URL) {
  const auth = await needUser();
  const formato = url.searchParams.get("formato") ?? "csv";
  if (entityName === "backup") {
    await requirePermission("configuracion", "exportar");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const sheets = [];
      for (const entity of ENTITIES) {
        if (!allowed(auth, entity.key, "exportar")) continue;
        const data = await collect(tx, auth.company.companyId, entity.key, "");
        sheets.push({ name: entity.label, columns: data.columns, rows: data.rows });
      }
      const buffer = await writeWorkbook(sheets);
      return binary(buffer, "backup-talon.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });
  }
  if (!isEntity(entityName)) throw new HttpError(404, "No conocemos esa exportación");
  guard(auth, entityName, "exportar");
  const filter = url.searchParams.get("q") ?? "";
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const data = await collect(tx, auth.company.companyId, entityName, filter);
    return fileResponse(formato, entityName, data.columns, data.rows, entityName);
  });
}

async function collect(tx: Tx, companyId: string, entity: EntityKey, q: string): Promise<ParsedSheet> {
  const columns = exampleColumns(entity);
  if (entity === "clientes" || entity === "proveedores") {
    const table = entity === "clientes" ? customers : suppliers;
    const term = q ? likeTerm(q) : "";
    const where = and(eq(table.companyId, companyId), term ? or(ilike(table.name, term), ilike(table.cuit, term), ilike(table.code, term)) : undefined);
    const rows = await tx.select().from(table).where(where).orderBy(table.name);
    const fields = await tx.select().from(customFieldValues).where(eq(customFieldValues.companyId, companyId));
    const defs = await tx.select().from(customFieldDefs).where(eq(customFieldDefs.companyId, companyId));
    const labels = defs.filter((field) => field.entity === (entity === "clientes" ? "cliente" : "proveedor"));
    const header = [...columns, ...labels.map((field) => field.label)];
    return {
      name: entity,
      columns: header,
      rows: rows.map((row) => {
        const base = entity === "clientes"
          ? [row.code, row.name, row.cuit ?? "", row.taxCondition, row.city ?? "", ""]
          : [row.code, row.name, row.cuit ?? "", row.taxCondition, row.city ?? ""];
        const extras = labels.map((field) => fields.find((value) => value.recordId === row.id && value.fieldId === field.id)?.value ?? "");
        return [...base, ...extras];
      }),
    };
  }
  if (entity === "articulos") {
    const term = q ? likeTerm(q) : "";
    const rows = await tx.select().from(products).where(and(eq(products.companyId, companyId), term ? or(ilike(products.name, term), ilike(products.sku, term)) : undefined)).orderBy(products.name);
    const rubros = await tx.select().from(customFieldDefs).where(eq(customFieldDefs.companyId, companyId));
    void rubros;
    const categoriesRows = await tx.execute<{ id: string; name: string }>(sql`select id::text, name from categories where company_id = ${companyId}`);
    return {
      name: "articulos",
      columns,
      rows: rows.map((row) => [row.sku, row.name, categoriesRows.find((category) => category.id === row.categoryId)?.name ?? "", String((row.ivaRateBps / 100).toString().replace(".", ",")), money(row.costCents), ""]),
    };
  }
  if (entity === "listas") {
    const rows = await tx.execute<{ lista: string; sku: string; price_cents: number }>(sql`
      select l.name as lista, p.sku, pr.price_cents
      from product_prices pr
      join price_lists l on l.id = pr.price_list_id
      join products p on p.id = pr.product_id
      where pr.company_id = ${companyId}
      order by l.name, p.sku
    `);
    return { name: "listas", columns, rows: rows.map((row) => [row.lista, row.sku, money(row.price_cents)]) };
  }
  if (entity === "stock") {
    const rows = await tx.execute<{ sku: string; deposito: string; quantity: string }>(sql`
      select p.sku, w.name as deposito, s.quantity::text
      from stock_levels s
      join products p on p.id = s.product_id
      join warehouses w on w.id = s.warehouse_id
      where s.company_id = ${companyId}
      order by p.sku
    `);
    return { name: "stock", columns, rows: rows.map((row) => [row.sku, row.deposito, row.quantity]) };
  }
  if (entity === "ventas" || entity === "compras") {
    const kind = entity === "ventas" ? "venta" : "compra";
    const term = q ? likeTerm(q) : "";
    const rows = await tx.execute<{ issued_on: string; code: string; letter: string | null; point_of_sale: number; number: number; party_cuit: string | null; party_name: string; net_taxed_cents: number; vat_cents: number; exempt_cents: number; net_untaxed_cents: number; perceptions_cents: number; other_taxes_cents: number; total_cents: number }>(sql`
      select d.issued_on::text, dt.code, d.letter, d.point_of_sale, d.number, d.party_cuit, d.party_name,
             d.net_taxed_cents, d.vat_cents, d.exempt_cents, d.net_untaxed_cents, d.perceptions_cents, d.other_taxes_cents, d.total_cents
      from documents d
      join document_types dt on dt.id = d.document_type_id
      where d.company_id = ${companyId} and d.kind = ${kind} and d.status = 'confirmado'
        and (${term} = '' or d.party_name ilike ${term} or d.party_cuit ilike ${term})
      order by d.issued_on, d.number
    `);
    return {
      name: entity,
      columns,
      rows: rows.map((row) => [row.issued_on, row.code, row.letter ?? "", String(row.point_of_sale), String(row.number), row.party_cuit ?? "", row.party_name, money(row.net_taxed_cents), money(row.vat_cents), money(row.exempt_cents), money(row.net_untaxed_cents), money(row.perceptions_cents), money(row.other_taxes_cents), money(row.total_cents)]),
    };
  }
  const rows = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.companyId, companyId)).orderBy(ledgerAccounts.code);
  return { name: "plan", columns, rows: rows.map((row) => [row.code, row.name, row.parentCode ?? "", row.imputable ? "si" : "no", row.kind]) };
}

async function fileResponse(formato: string, entity: string, columns: string[], rows: string[][], filename: string) {
  if (formato === "xlsx") {
    const buffer = await writeWorkbook([{ name: entity, columns, rows }]);
    return binary(buffer, `${filename}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  const delimiter = formato === "txt" ? "\t" : ";";
  return new Response(toDelimited(columns, rows, delimiter), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.${formato === "txt" ? "txt" : "csv"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function binary(data: Buffer, filename: string, type: string) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function readSheets(filename: string, buffer: Buffer, delimiter: string, widths: string, hasHeader: boolean): Promise<ParsedSheet[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dbf")) {
    const { parseDbf } = await import("@/lib/io/dbf");
    return [parseDbf(buffer, filename)];
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return readWorkbook(buffer);
  const text = buffer.toString("utf8");
  if (delimiter === "fixed") return [parseFixedWidth(text, parseWidths(widths), hasHeader)];
  return [parseDelimited(text, delimiter === "auto" ? undefined : delimiter === "tab" ? "\t" : delimiter === "comma" ? "," : delimiter === "semicolon" ? ";" : undefined)];
}

function tagSheet(sheet: ParsedSheet): { entity: EntityKey; columns: string[]; rows: string[][] }[] {
  const name = normalizeHeader(sheet.name);
  const entity = ENTITIES.find((item) => name.startsWith(normalizeHeader(item.label)) || name.startsWith(item.key));
  if (!entity) return [];
  return [{ entity: entity.key, columns: sheet.columns, rows: sheet.rows }];
}

function isEntity(value: string): value is EntityKey {
  return ENTITIES.some((entity) => entity.key === value);
}

function summarize(rows: ReviewedRow[]) {
  return {
    total: rows.length,
    errors: rows.filter((row) => row.errors.length > 0).length,
    warnings: rows.filter((row) => row.warnings.length > 0).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    missingIva: rows.filter((row) => row.missingIva).length,
  };
}

function previewOf(rowNumber: number, result: ReviewedRow) {
  return { rowNumber, values: result.values, errors: result.errors, warnings: result.warnings, duplicate: result.duplicate, missingIva: result.missingIva };
}

function fieldChoices(entity: EntityKey, extra: { key: string; label: string }[]) {
  return [...FIELDS[entity].map((field) => ({ key: field.key, label: field.label })), ...extra.map((field) => ({ key: field.key, label: `Campo: ${field.label}` }))];
}

async function existingKeys(tx: Tx, companyId: string, entity: EntityKey): Promise<Set<string>> {
  const results = new Set<string>();
  if (entity === "clientes" || entity === "proveedores") {
    const table = entity === "clientes" ? customers : suppliers;
    const rows = await tx.select({ cuit: table.cuit, code: table.code, name: table.name }).from(table).where(eq(table.companyId, companyId));
    for (const row of rows) {
      const digits = (row.cuit ?? "").replace(/\D/g, "");
      if (digits.length === 11) results.add(`cuit:${digits}`);
      results.add(`code:${row.code.toLowerCase()}`);
      results.add(`name:${row.name.toLowerCase()}`);
    }
  }
  if (entity === "articulos") {
    const rows = await tx.select({ sku: products.sku }).from(products).where(eq(products.companyId, companyId));
    for (const row of rows) results.add(row.sku.toLowerCase());
  }
  return results;
}

async function oneJob(tx: Tx, companyId: string, jobId: string) {
  const rows = await tx.execute<{ id: string; entity: string; filename: string; status: string; user_id: string; columns: unknown; mapping: unknown; summary: unknown }>(sql`
    select id::text, entity, filename, status, user_id::text, columns, mapping, summary from import_jobs where id = ${jobId} and company_id = ${companyId}
  `);
  if (!rows[0]) throw new HttpError(404, "No encontramos esa importación");
  return rows[0];
}

async function summaryOf(tx: Tx, jobId: string) {
  const rows = await tx.execute<{ total: number; errors: number; warnings: number; duplicates: number; missing_iva: number }>(sql`
    select count(*)::int as total,
           count(*) filter (where jsonb_array_length(errors) > 0)::int as errors,
           count(*) filter (where jsonb_array_length(warnings) > 0)::int as warnings,
           count(*) filter (where duplicate)::int as duplicates,
           count(*) filter (where missing_iva)::int as missing_iva
    from import_rows where job_id = ${jobId}
  `);
  const row = rows[0];
  return { total: row?.total ?? 0, errors: row?.errors ?? 0, warnings: row?.warnings ?? 0, duplicates: row?.duplicates ?? 0, missingIva: row?.missing_iva ?? 0 };
}

async function previewRows(tx: Tx, jobId: string, page = 1) {
  const offset = (page - 1) * 80;
  const rows = await tx.execute<{ row_number: number; values: Record<string, string>; errors: string[]; warnings: string[]; duplicate: boolean; missing_iva: boolean }>(sql`
    select row_number, values, errors, warnings, duplicate, missing_iva
    from import_rows where job_id = ${jobId}
    order by row_number
    limit 80 offset ${offset}
  `);
  return rows.map((row) => ({ rowNumber: row.row_number, values: row.values, errors: row.errors, warnings: row.warnings, duplicate: row.duplicate, missingIva: row.missing_iva }));
}

function money(cents: number): string {
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}

void desc;
void documentTypes;
void documents;
void stockLevels;
void warehouses;
void or;
void entityModule;
