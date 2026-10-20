import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../scripts/load-env";

loadEnv();
const enabled = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("RLS", () => {
  it("un vendedor no lee proveedores y no ve la otra empresa", async () => {
    const { getDb, closeDb } = await import("./client");
    const { withTenant } = await import("./tenant");
    const db = getDb();
    const users = await db.execute<{ id: string }>(sql`select id from auth_find_user('mateo@talon.demo')`);
    const home = await db.execute<{ company_id: string }>(sql`select auth_home_company(${users[0].id}::uuid) as company_id`);
    const postgres = (await import("postgres")).default;
    const admin = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1 });
    const other = await admin<{ id: string }[]>`select id from companies where slug = 'costa-servicios'`;
    await admin.end();
    const hidden = await db.execute<{ n: number }>(sql`select count(*)::int as n from customers`);
    expect(Number(hidden[0].n)).toBe(0);

    const own = await withTenant(home[0].company_id, users[0].id, async (tx) => {
      const customers = await tx.execute<{ n: number }>(sql`select count(*)::int as n from customers`);
      const suppliers = await tx.execute<{ n: number }>(sql`select count(*)::int as n from suppliers`);
      return { customers: Number(customers[0].n), suppliers: Number(suppliers[0].n) };
    });
    expect(own.customers).toBeGreaterThan(0);
    expect(own.suppliers).toBe(0);

    const foreign = await withTenant(other[0].id, users[0].id, async (tx) => {
      const customers = await tx.execute<{ n: number }>(sql`select count(*)::int as n from customers`);
      return Number(customers[0].n);
    });
    expect(foreign).toBe(0);
    await closeDb();
  });

  afterAll(() => undefined);
});
