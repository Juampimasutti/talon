// Uso (instalador, no interactivo):
//   npm run talon:modo -- estudio --empresa todas
//   npm run talon:modo -- negocio --empresa <id|slug>
//   TALON_MODO=estudio npm run talon:modo            (modo por variable, empresa = todas)
// Requiere DATABASE_URL_ADMIN. Sale con código 0 si aplicó (o ya estaba), 1 si hay error.
import postgres from "postgres";
import { loadEnv } from "./load-env";
import { applyCompanyMode } from "./talon-modo-core";
import { COMPANY_MODES, type CompanyMode } from "../src/lib/company-setup";

loadEnv();
const args = process.argv.slice(2);
const flag = args.indexOf("--empresa");
const target = flag >= 0 ? args[flag + 1] : "todas";
const positional = args.filter((_, index) => index !== flag && index !== flag + 1)[0];
const mode = (positional ?? process.env.TALON_MODO ?? "").trim().toLowerCase();
if (!COMPANY_MODES.includes(mode as CompanyMode) || !target) {
  console.error("Uso: npm run talon:modo -- <negocio|estudio> [--empresa <id|slug|todas>]  (o TALON_MODO=...)");
  process.exit(1);
}
const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("Falta DATABASE_URL_ADMIN");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
applyCompanyMode(sql, mode as CompanyMode, target)
  .then((results) => {
    for (const row of results) console.log(`${row.slug}: ${row.changed ? "aplicado" : "sin cambios"} → ${mode} [${row.enabledModules.join(", ")}]`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
