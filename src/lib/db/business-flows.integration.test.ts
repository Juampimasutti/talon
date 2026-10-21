import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../scripts/load-env";

loadEnv();
const enabled = process.env.RUN_FLOW_TESTS === "1";
const database = `talon_flow_${randomUUID().replaceAll("-", "")}`;
const customerId = randomUUID();
const productId = randomUUID();
let server: ChildProcess | undefined;
let sql: ReturnType<typeof postgres> | undefined;
let base = "";
let cookie = "";
let companyId = "";
let warehouseId = "";
let cashAccountId = "";
let invoiceType = "";
let creditType = "";
let log = "";

function urlFor(key: string, db: string) {
  const url = new URL(process.env[key] ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Las pruebas de circuitos sólo permiten PostgreSQL local.");
  }
  url.pathname = `/${db}`;
  return url.toString();
}

async function request(path: string, body?: unknown, expected = 200) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const cookies = new Map(cookie.split("; ").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index), part.slice(index + 1)];
  }));
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";", 1)[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(expected);
  return result.data;
}

async function balances() {
  const [row] = await sql!`
    select
      (select coalesce(sum(quantity),0)::float from stock_movements where product_id=${productId}) as stock,
      (select coalesce(sum(debit_cents-credit_cents),0)::float from current_account_entries where party_id=${customerId}) as debt,
      (select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::float from cash_movements where cash_account_id=${cashAccountId}) as cash
  `;
  const [level] = await sql!`select quantity::float as quantity from stock_levels where product_id=${productId} and warehouse_id=${warehouseId}`;
  expect(level.quantity).toBe(row.stock);
  return { stock: row.stock, debt: row.debt, cash: row.cash };
}

function draft(paymentMethod: string, quantity = 2, sourceDocumentId?: string) {
  return {
    kind: "venta", documentTypeId: sourceDocumentId ? creditType : invoiceType,
    partyId: customerId, issuedOn: new Date().toISOString().slice(0, 10),
    paymentMethod, warehouseId, cashAccountId, sourceDocumentId,
    lines: [{ productId, quantity, unitPriceCents: 10_000, discountBps: 0 }],
  };
}

describe.skipIf(!enabled)("circuitos HTTP con PostgreSQL aislado y servidor de producción", () => {
  beforeAll(async () => {
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1 });
    try { await root.unsafe(`create database ${database}`); } finally { await root.end(); }
    const env = { ...process.env, DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database), DATABASE_URL: urlFor("DATABASE_URL", database) };
    for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
      execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe", timeout: 120_000 });
    }
    sql = postgres(env.DATABASE_URL_ADMIN, { max: 1 });
    [ { id: companyId } ] = await sql`select id from companies where slug='distribuidora-parana'`;
    [ { id: warehouseId } ] = await sql`select id from warehouses where company_id=${companyId} and is_default=true`;
    [ { id: invoiceType } ] = await sql`select id from document_types where company_id=${companyId} and code='FAC'`;
    [ { id: creditType } ] = await sql`select id from document_types where company_id=${companyId} and code='NCR'`;
    const cash = await sql`insert into cash_accounts(company_id,name,kind) values(${companyId},'QA circuitos','caja') returning id`;
    cashAccountId = cash[0].id;
    await sql`insert into customers(id,company_id,code,name,tax_condition) values(${customerId},${companyId},'QA-FLOW','Cliente QA circuitos','ri')`;
    await sql`insert into products(id,company_id,sku,name,iva_rate_bps,cost_cents) values(${productId},${companyId},'QA-FLOW','Producto QA',2100,5000)`;
    await sql`insert into stock_movements(company_id,product_id,warehouse_id,quantity,reason) values(${companyId},${productId},${warehouseId},50,'Fixture QA')`;
    await sql`insert into stock_levels(company_id,product_id,warehouse_id,quantity) values(${companyId},${productId},${warehouseId},50)`;
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer();
      listener.on("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string") return reject(new Error("Sin puerto"));
        listener.close(() => resolve(address.port));
      });
    });
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", (data) => { log = (log + data).slice(-12_000); });
    server.stderr?.on("data", (data) => { log = (log + data).slice(-12_000); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* Wait for startup. */ }
      if (ready) break;
      if (server.exitCode !== null) throw new Error(log);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(ready, log).toBe(true);
    await request("auth/login", { email: "laura@talon.demo", password: "talon1234" });
    await request("auth/empresa", { companyId });
  }, 180_000);

  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
      server.kill("SIGKILL");
      await exited;
    }
    await sql?.end();
    const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), { max: 1 });
    try { await root.unsafe(`drop database if exists ${database} with (force)`); } finally { await root.end(); }
  }, 20_000);

  it("venta a cuenta, cobro parcial, anulación del recibo y de la venta restauran los tres saldos", async () => {
    const initial = await balances();
    const sale = await request("documentos", draft("cuenta_corriente"));
    expect(sale.totalCents).toBe(24_200);
    const persisted = await request(`documentos/${sale.id}`);
    expect(persisted.totalCents).toBe(24_200);
    expect(persisted.status).toBe("confirmado");
    expect(persisted.lines).toHaveLength(1);
    expect(await balances()).toEqual({ ...initial, stock: initial.stock - 2, debt: initial.debt + 24_200 });
    const receipt = await request("cuentas/cobro", { partyType: "customer", partyId: customerId, cashAccountId, amountCents: 10_000, description: "Recibo QA", occurredOn: new Date().toISOString().slice(0, 10) });
    expect(await balances()).toEqual({ stock: initial.stock - 2, debt: initial.debt + 14_200, cash: initial.cash + 10_000 });
    await request(`documentos/${receipt.id}/anular`, { reason: "QA reversión" });
    await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
    expect(await balances()).toEqual(initial);
    await request(`documentos/${sale.id}/anular`, {}, 400);
    expect(await balances()).toEqual(initial);
  });

  it("venta al contado y nota de crédito reintegran caja y stock; impide exceder lo facturado", async () => {
    const initial = await balances();
    const sale = await request("documentos", draft("contado"));
    expect(sale.totalCents).toBe(24_200);
    expect(await balances()).toEqual({ stock: initial.stock - 2, debt: initial.debt, cash: initial.cash + 24_200 });
    await request("documentos", draft("contado", 2, sale.id));
    expect(await balances()).toEqual(initial);
    await request("documentos", draft("contado", 1, sale.id), 409);
    expect(await balances()).toEqual(initial);
  });

  it("stock insuficiente revierte la transacción completa", async () => {
    const initial = await balances();
    const [before] = await sql!`select count(*)::int as count from documents where party_id=${customerId}`;
    await request("documentos", draft("contado", 1_000), 409);
    expect(await balances()).toEqual(initial);
    const [after] = await sql!`select count(*)::int as count from documents where party_id=${customerId}`;
    expect(after.count).toBe(before.count);
  });

  it("dos notas de crédito simultáneas no pueden acreditar más que la factura", async () => {
    const initial = await balances();
    const sale = await request("documentos", draft("cuenta_corriente"));
    const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/documentos`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(draft("cuenta_corriente", 1.5, sale.id)),
      signal: AbortSignal.timeout(20_000),
    })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await balances()).toEqual({ stock: initial.stock - 0.5, debt: initial.debt + 6_050, cash: initial.cash });
    const credit = await responses.find((response) => response.status === 200)!.json();
    await request(`documentos/${credit.data.id}/anular`, { reason: "QA reversión" });
    await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
    expect(await balances()).toEqual(initial);
  });

  it("un contador no puede emitir ni anular, y otra empresa no puede leer la venta", async () => {
    const initial = await balances();
    const sale = await request("documentos", draft("cuenta_corriente"));
    const adminCookie = cookie;
    try {
      cookie = "";
      await request("auth/login", { email: "hector@talon.demo", password: "talon1234" });
      await request("auth/empresa", { companyId });
      await request(`documentos/${sale.id}`);
      await request("documentos", draft("contado"), 403);
      await request(`documentos/${sale.id}/anular`, {}, 403);
      cookie = adminCookie;
      const [other] = await sql!`select id from companies where slug='costa-servicios'`;
      await request("auth/empresa", { companyId: other.id });
      await request(`documentos/${sale.id}`, undefined, 404);
    } finally {
      cookie = adminCookie;
    }
    await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
    expect(await balances()).toEqual(initial);
  });
});
