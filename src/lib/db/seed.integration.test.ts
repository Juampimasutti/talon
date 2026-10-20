import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../scripts/load-env";

loadEnv();

const adminUrl = process.env.DATABASE_URL_ADMIN ?? "";
const enabled = Boolean(adminUrl);
const database = "talon_seed_check";

function adminOn(db: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  return url.toString();
}

describe.skipIf(!enabled)("seed en base limpia", () => {
  it("aplica las migraciones y deja la isla 1 con número", async () => {
    const root = postgres(adminOn("postgres"), { max: 1 });
    await root.unsafe(`drop database if exists ${database}`);
    await root.unsafe(`create database ${database}`);
    await root.end();
    const env = {
      ...process.env,
      DATABASE_URL: adminOn(database).replace("talon_admin:talon_admin", "talon_app:talon_app"),
      DATABASE_URL_ADMIN: adminOn(database),
    };
    execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env, stdio: "pipe" });
    execFileSync("npx", ["tsx", "scripts/seed.ts"], { env, stdio: "pipe" });
    const sql = postgres(adminOn(database), { max: 1 });
    const pumps = await sql<{ name: string; number: number }[]>`select name, number from fuel_pumps order by number`;
    expect(pumps.some((pump) => pump.name === "Isla 1" && pump.number === 1)).toBe(true);
    await sql.end();
  }, 180_000);

  afterAll(async () => {
    if (!enabled) return;
    const root = postgres(adminOn("postgres"), { max: 1 });
    await root.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${database}' and pid <> pg_backend_pid()`);
    await root.unsafe(`drop database if exists ${database}`);
    await root.end();
  });
});
