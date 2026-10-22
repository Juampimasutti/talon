import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("Falta DATABASE_URL_ADMIN");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function main() {
const roles = await sql`select 1 from pg_roles where rolname = 'talon_app'`;
if (roles.length === 0) {
  try {
    await sql.unsafe("CREATE ROLE talon_app LOGIN PASSWORD 'talon_app' NOSUPERUSER NOBYPASSRLS");
    console.log("Rol talon_app creado");
  } catch (error) {
    console.warn("No pude crear talon_app. Si usás Supabase/Neon, crealo a mano. El detalle:", error);
  }
}

await sql.unsafe(`
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )
`);

const files = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  const applied = await sql`select 1 from schema_migrations where id = ${file}`;
  if (applied.length > 0) {
    console.log(`ya estaba ${file}`);
    continue;
  }
  const body = readFileSync(join(migrationDirectory, file), "utf8");
  console.log(`aplicando ${file}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into schema_migrations (id) values (${file})`;
  });
}

await sql.end();
console.log("Migraciones al día");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
