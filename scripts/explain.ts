import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) throw new Error("Falta la URL de la base");
const sql = postgres(url, { max: 1, onnotice: () => {} });

const lines: string[] = [];
function log(text: string) {
  console.log(text);
  lines.push(text);
}

const company = await sql<{ id: string }[]>`select id from companies where slug = 'distribuidora-parana'`;
const companyId = company[0]?.id;
if (!companyId) throw new Error("Corrá el seed antes de medir");

async function explain(title: string, query: string) {
  log(`\n## ${title}`);
  const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  for (const row of rows) log(String(Object.values(row)[0]));
}

const term = "%yerba%";
await explain(
  "Búsqueda de artículos por nombre",
  `select id, sku, name from products where company_id = '${companyId}' and (name ilike '${term}' or sku ilike '${term}') order by name limit 40`,
);
await explain(
  "Listado de ventas con el tipo, en una sola consulta",
  `select d.id, d.party_name, d.total_cents, dt.code
     from documents d
     join document_types dt on dt.id = d.document_type_id
    where d.company_id = '${companyId}' and d.kind = 'venta'
    order by d.issued_on desc
    limit 40`,
);

log("\n## SKU exacto sobre el padrón demo");
await explain(
  "Búsqueda por SKU exacto",
  `select id from products where company_id = '${companyId}' and sku = 'ART-00010'`,
);

log("\n## Trigrama contra recorrido de tabla, con 40.000 artículos extra (se deshacen)");
await sql.begin(async (tx) => {
  await tx`
    insert into products (company_id, sku, name, iva_rate_bps, cost_cents)
    select ${companyId}, 'TMP-' || g, 'Producto temporal ' || g, 2100, 1000
    from generate_series(1, 40000) g
  `;
  await tx`analyze products`;
  await tx`set local enable_seqscan = off`;
  const indexed = await tx.unsafe(
    `EXPLAIN (ANALYZE, FORMAT TEXT) select id from products where company_id = '${companyId}' and name ilike '%temporal 39999%'`,
  );
  log("\nÍndice trigrama (recorrido secuencial apagado):");
  for (const row of indexed) log(String(Object.values(row)[0]));
  await tx`set local enable_seqscan = on`;
  await tx`set local enable_indexscan = off`;
  await tx`set local enable_bitmapscan = off`;
  await tx`set local enable_indexonlyscan = off`;
  const sequential = await tx.unsafe(
    `EXPLAIN (ANALYZE, FORMAT TEXT) select id from products where company_id = '${companyId}' and name ilike '%temporal 39999%'`,
  );
  log("\nRecorrido secuencial forzado:");
  for (const row of sequential) log(String(Object.values(row)[0]));
  throw new Error("ROLLBACK");
}).catch((error: Error) => {
  if (error.message !== "ROLLBACK") throw error;
});

log("\n## N+1 contra un solo join");
const ids = await sql<{ id: string }[]>`
  select id from documents where company_id = ${companyId} and kind = 'venta' limit 40
`;
const startedMany = performance.now();
for (const row of ids) {
  await sql`select id, description from document_lines where document_id = ${row.id}`;
}
const manyMs = performance.now() - startedMany;
const startedJoin = performance.now();
await sql`
  select d.id, l.description
    from documents d
    left join document_lines l on l.document_id = d.id
   where d.id = any(${ids.map((row) => row.id)})
`;
const joinMs = performance.now() - startedJoin;
log(`40 comprobantes, una consulta de renglones por cada uno: ${manyMs.toFixed(1)} ms`);
log(`Los mismos 40, un solo join: ${joinMs.toFixed(1)} ms`);
log(`Consultas del camino malo: ${ids.length}. Consultas del camino usado por la ficha y el listado: 1.`);

mkdirSync("docs", { recursive: true });
writeFileSync("docs/explain.txt", lines.join("\n"));
await sql.end();
console.log("\nGuardado en docs/explain.txt");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
