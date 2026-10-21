import { spawn } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as query } from "drizzle-orm";
import { loadEnv } from "./load-env";
import * as schema from "../src/lib/db/schema";
import { createDocument } from "../src/lib/domain/documents";

loadEnv();
const database = "talon_demo_fija";

function localUrl(key: string, name: string) {
  const url = new URL(process.env[key] ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("La demo fija sólo admite PostgreSQL local.");
  }
  url.pathname = `/${name}`;
  return url.toString();
}

async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`El proceso terminó con código ${code}`)));
  });
}

async function main() {
  const root = postgres(localUrl("DATABASE_URL_ADMIN", "postgres"), { max: 1 });
  try {
    const existing = await root`select 1 from pg_database where datname=${database}`;
    if (!existing.length) await root.unsafe(`create database ${database}`);
  } finally { await root.end(); }
  process.env.DATABASE_URL_ADMIN = localUrl("DATABASE_URL_ADMIN", database);
  process.env.DATABASE_URL = localUrl("DATABASE_URL", database);
  process.env.ARCA_MODE = "mock";
  await run(["--import", "tsx", "scripts/migrate.ts"]);
  await run(["--import", "tsx", "scripts/seed.ts"]);

  const connection = postgres(process.env.DATABASE_URL_ADMIN, { max: 1 });
  const db = drizzle(connection, { schema });
  try {
    await db.transaction(async (tx) => {
      // Serializes two setup commands; the fixture and its marker commit together.
      await tx.execute(query`select pg_advisory_xact_lock(260021)`);
      const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.slug, "distribuidora-parana"));
      const [loaded] = await tx.select().from(schema.customers).where(query`${schema.customers.companyId}=${company.id} and ${schema.customers.code}='DEMO-FIJA-SALDO'`);
      if (loaded) {
        console.log("Escenarios ya cargados: se conservan los datos y cambios de la demo.");
        return;
      }
      const [actor] = await tx.select().from(schema.users).where(eq(schema.users.email, "laura@talon.demo"));
      const [warehouse] = await tx.select().from(schema.warehouses).where(query`${schema.warehouses.companyId}=${company.id} and ${schema.warehouses.isDefault}=true`);
      const [cash] = await tx.select().from(schema.cashAccounts).where(eq(schema.cashAccounts.companyId, company.id));
      const types = await tx.select().from(schema.documentTypes).where(eq(schema.documentTypes.companyId, company.id));
      const type = (code: string) => {
        const found = types.find((item) => item.code === code);
        if (!found) throw new Error(`Falta tipo ${code}`);
        return found.id;
      };
      const customers = await tx.insert(schema.customers).values([
        { companyId: company.id, code: "DEMO-FIJA-SALDO", name: "DEMO · Cliente con saldo y devolución", taxCondition: "ri" },
        { companyId: company.id, code: "DEMO-FIJA-ANTICIPO", name: "DEMO · Cliente con anticipo", taxCondition: "cf" },
        { companyId: company.id, code: "DEMO-FIJA-DESCUENTO", name: "DEMO · Cliente con descuento 10%", taxCondition: "ri", discountBps: 1000 },
      ]).returning();
      const [product] = await tx.insert(schema.products).values({ companyId: company.id, sku: "DEMO-FIJA-001", name: "DEMO · Artículo para recorridos", ivaRateBps: 2100, costCents: 5000, minStock: 10 }).returning();
      await tx.execute(query`insert into stock_levels(company_id,product_id,warehouse_id,quantity) values(${company.id},${product.id},${warehouse.id},100)`);
      await tx.insert(schema.stockMovements).values({ companyId: company.id, productId: product.id, warehouseId: warehouse.id, quantity: 100, reason: "Apertura demo fija", createdBy: actor.id });
      const lists = await tx.select().from(schema.priceLists).where(eq(schema.priceLists.companyId, company.id));
      await tx.insert(schema.productPrices).values(lists.map((list) => ({ companyId: company.id, productId: product.id, priceListId: list.id, priceCents: 10_000 })));
      const ctx = { companyId: company.id, userId: actor.id };
      const date = (ago: number) => {
        const value = new Date(); value.setUTCDate(value.getUTCDate() - ago);
        return value.toISOString().slice(0, 10);
      };
      const sale = async (partyId: string, ago: number, quantity: number) => createDocument(tx, ctx, {
        kind: "venta", documentTypeId: type("FAC"), partyId, issuedOn: date(ago),
        paymentMethod: "cuenta_corriente", warehouseId: warehouse.id,
        notes: "Escenario ficticio de demo fija", lines: [{ productId: product.id, quantity, unitPriceCents: 10_000 }],
      });
      const first = await sale(customers[0].id, 20, 10);
      await sale(customers[0].id, 10, 5);
      await sale(customers[2].id, 3, 4);
      await createDocument(tx, ctx, {
        kind: "venta", documentTypeId: type("NCR"), partyId: customers[0].id,
        issuedOn: date(2), paymentMethod: "cuenta_corriente", warehouseId: warehouse.id,
        sourceDocumentId: first.id, notes: "Devolución parcial ficticia",
        lines: [{ productId: product.id, quantity: 2, unitPriceCents: 10_000 }],
      });
      for (const [customer, amount] of [[customers[0], 30_000], [customers[1], 20_000]] as const) {
        await createDocument(tx, ctx, {
          kind: "venta", documentTypeId: type("REC"), partyId: customer.id,
          issuedOn: date(1), paymentMethod: "contado", collectCash: true, cashAccountId: cash.id,
          notes: "Recibo ficticio: cobro parcial o anticipo",
          lines: [{ description: "Cobro demo", quantity: 1, unitPriceCents: amount, ivaRateBps: 0 }],
        });
      }
      console.log("Agregados: saldo previo, cobro parcial, devolución, anticipo y descuento.");
    });
  } finally { await connection.end(); }
  console.log("Demo fija local preparada en talon_demo_fija. No se borra al cerrar.");
  if (process.argv.includes("--serve")) {
    await run(["node_modules/next/dist/bin/next", "build"]);
    await run(["scripts/shell-assets.mjs"]);
    await run(["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "4319"]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudo preparar la demo fija");
  process.exitCode = 1;
});
