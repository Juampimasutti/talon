import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();
async function main() {
  const email = process.argv[2]?.trim();
  const scope = process.argv[3] ?? "estudio";
  if (!email || !["estudio", "superadmin", "revocar"].includes(scope))
    throw Error(
      "Uso: npm run empresa:autorizar -- usuario@dominio estudio|superadmin|revocar",
    );
  const url = new URL(process.env.DATABASE_URL_ADMIN ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("Este comando de configuración sólo permite PostgreSQL local");
  const connection = postgres(url.toString(), { max: 1 });
  try {
    const [user] =
      await connection`select id from users where lower(email)=lower(${email}) and active`;
    if (!user) throw Error("El usuario no existe o está inactivo");
    if (scope === "revocar")
      await connection`delete from company_operators where user_id=${user.id}`;
    else
      await connection`insert into company_operators(user_id,scope) values(${user.id},${scope}) on conflict(user_id) do update set scope=excluded.scope`;
    console.log(
      scope === "revocar"
        ? "Autorización global revocada"
        : "Autorización global actualizada",
    );
  } finally {
    await connection.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "No se pudo configurar",
  );
  process.exitCode = 1;
});
