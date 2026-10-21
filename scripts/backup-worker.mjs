import { mkdir, access, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { loadEnv } from "./load-env-runtime.mjs";

loadEnv();
export async function backupOnce() {
  const url = new URL(process.env.DATABASE_URL_ADMIN ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("Los respaldos automáticos locales requieren PostgreSQL local");
  const database = url.pathname.slice(1);
  const folder = resolve(process.env.TALON_BACKUP_DIR || "backups", database);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    // Un único trabajador por base, incluso si coinciden el servidor y Windows.
    const [gate] = await sql`select pg_try_advisory_lock(260028, 14) as acquired`;
    if (!gate.acquired) return { folder, written: 0 };
    const companies =
      await sql`select c.id,(select m.user_id from memberships m join roles r on r.id=m.role_id join users u on u.id=m.user_id where m.company_id=c.id and m.active and u.active and r.company_id=c.id and r.key='admin' order by m.user_id limit 1) as actor_id from companies c`;
    for (const company of companies) {
      if (!company.actor_id) continue;
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${company.id},260026))`;
        const existing =
          await tx`select 1 from company_lifecycle_events where target_id=${company.id} and action='automatico' and created_at>now()-interval '24 hours' and backup->'schemaMigrations'=(select jsonb_agg(id order by id) from schema_migrations) limit 1`;
        if (existing.length) return;
        // Revalidar después de esperar: una eliminación puede haber finalizado.
        const valid = await tx`select 1 from companies where id=${company.id}`;
        if (!valid.length) return;
        await tx`insert into company_lifecycle_events(target_id,target_name,actor_id,action,backup) select id,name,${company.actor_id},'automatico',company_snapshot(id) from companies where id=${company.id}`;
      });
    }
    const available=await sql`select id from company_lifecycle_events where backup is not null order by created_at`;
    const missing=[];
    for(const event of available){
      try{await access(join(folder,`talon-${event.id}.json`));}catch{missing.push(event.id);}
    }
    // Leer el contenido sólo de las copias todavía no exportadas, en un único lote.
    const events=missing.length ? await sql`select id,backup from company_lifecycle_events where id in ${sql(missing)}` : [];
    let written=0;
    for(const event of events){
      const file=join(folder,`talon-${event.id}.json`);
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(event.backup), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, file);
      written++;
    }
    // Retener sólo las últimas 14 automáticas por empresa. Las manuales y las
    // previas a vaciar/eliminar/recuperar nunca se purgan automáticamente.
    const expired = await sql`
      select id,target_id from (
        select id,target_id,row_number() over(partition by target_id order by created_at desc,id desc) as position
        from company_lifecycle_events where action='automatico' and backup is not null
      ) ranked where position>14`;
    for (const event of expired) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${event.target_id}::text,260026))`;
        // Mantener el evento de auditoría, retirar sólo su copia vencida.
        await rm(join(folder, `talon-${event.id}.json`), { force: true });
        await tx`update company_lifecycle_events set backup=null where id=${event.id} and action='automatico'`;
      });
    }
    if (written)
      console.log(`Respaldos: ${written} copias guardadas en ${folder}`);
    return { folder, written };
  } finally {
    await sql.end();
  }
}
async function main() {
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  do {
    try {
      await backupOnce();
    } catch (error) {
      console.error(
        "No se pudo completar el respaldo automático:",
        error instanceof Error ? error.message : "Error desconocido",
      );
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once")) break;
    // El proceso duerme sin mantener una conexión de base abierta.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      const stop = () => {
        clearTimeout(timer);
        resolve();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      setTimeout(() => {
        process.removeListener("SIGTERM", stop);
        process.removeListener("SIGINT", stop);
      }, 60_010).unref();
    });
  } while (!stopping);
}
void main();
