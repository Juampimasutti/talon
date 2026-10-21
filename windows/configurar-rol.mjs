import postgres from 'postgres';
import { loadConfig, childEnv } from './comun.mjs';
const config = loadConfig();
const sql = postgres(childEnv(config).DATABASE_URL_ADMIN, { max: 1 });
try {
  // La clave se valida como hexadecimal antes de componer esta sentencia DDL.
  await sql.unsafe(`ALTER ROLE talon_app WITH PASSWORD '${config.TALON_WINDOWS_APP_PASSWORD}'`);
} catch { console.error('No se pudo configurar el rol restringido de la demo.'); process.exitCode = 1; }
finally { await sql.end(); }
