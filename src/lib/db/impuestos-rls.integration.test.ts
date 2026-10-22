import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../scripts/load-env";

loadEnv();
const enabled = process.env.RUN_DB_TESTS === "1";
const database = `talon_tax_rls_${randomUUID().replaceAll("-", "")}`;
let admin: ReturnType<typeof postgres> | undefined;
let app: ReturnType<typeof postgres> | undefined;
let companyA = "";
let companyB = "";
let laura = "";
let mateo = "";

function urlFor(key: "DATABASE_URL_ADMIN" | "DATABASE_URL", db: string) {
  const url = new URL(process.env[key] ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Las pruebas de impuestos sólo permiten PostgreSQL local");
  }
  url.pathname = `/${db}`;
  return url.toString();
}

describe.skipIf(!enabled)("impuestos RLS", () => {
  beforeAll(async () => {
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1, onnotice: () => {} });
    try {
      await root.unsafe(`create database ${database}`);
    } finally {
      await root.end();
    }
    const env = {
      ...process.env,
      DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database),
      DATABASE_URL: urlFor("DATABASE_URL", database),
      ARCA_MODE: "mock",
    };
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env, stdio: "pipe", timeout: 180_000 });
    execFileSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], { env, stdio: "pipe", timeout: 180_000 });
    admin = postgres(env.DATABASE_URL_ADMIN, { max: 1, onnotice: () => {} });
    app = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const companies = await admin`select id,slug,enabled_modules from companies where slug in ('distribuidora-parana','costa-servicios')`;
    companyA = companies.find((row) => row.slug === "distribuidora-parana")!.id;
    companyB = companies.find((row) => row.slug === "costa-servicios")!.id;
    expect(companies.every((row) => !row.enabled_modules.includes("impuestos"))).toBe(true);
    const users = await admin`select id,email from users where email in ('laura@talon.demo','mateo@talon.demo')`;
    laura = users.find((row) => row.email === "laura@talon.demo")!.id;
    mateo = users.find((row) => row.email === "mateo@talon.demo")!.id;
  }, 180_000);

  afterAll(async () => {
    await Promise.all([admin?.end(), app?.end()]);
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1, onnotice: () => {} });
    try {
      await root.unsafe(`drop database if exists ${database} with (force)`);
    } finally {
      await root.end();
    }
  }, 20_000);

  it("mantiene referencias globales de solo lectura y aísla empresas", async () => {
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      const rates = await tx`select codigo,bps from imp_alicuotas order by codigo`;
      expect(rates).toHaveLength(6);
      await tx`insert into imp_config(company_id) values(${companyA})`;
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${laura},true)`;
      await tx`insert into imp_config(company_id) values(${companyB})`;
    })).rejects.toMatchObject({ code: "42501" });
    await app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${mateo},true)`;
      const rows = await tx`select * from imp_config`;
      expect(rows).toHaveLength(0);
    });
    await expect(app!.begin(async (tx) => {
      await tx`select set_config('app.company_id',${companyA},true),set_config('app.user_id',${mateo},true)`;
      await tx`insert into imp_puntos_venta(company_id,numero,sistema) values(${companyA},1,'manual')`;
    })).rejects.toMatchObject({ code: "42501" });
  });
});
