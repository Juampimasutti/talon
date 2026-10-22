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
  const cookies = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), part.slice(index + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";", 1)[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  const result = await response.json();
  expect(
    response.status,
    `${path}: ${JSON.stringify(result)}${response.status === 500 ? "\n" + log.slice(-6000) : ""}`,
  ).toBe(expected);
  return result.data;
}

async function reverseOperation(sector: string, resource: string, id: string) {
  const path = `reversiones/${sector}/${resource}/${id}`;
  const preview = await request(path);
  const before = await sql!`select count(*)::int as n from business_reversals`;
  await request(
    path,
    {
      reason: "Corrección QA",
      confirmation: "ANULAR",
      fingerprint: "0".repeat(64),
    },
    409,
  );
  const after = await sql!`select count(*)::int as n from business_reversals`;
  expect(after).toEqual(before);
  const responses = await Promise.all(
    [0, 1].map(() =>
      fetch(`${base}/api/${path}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Corrección QA",
          confirmation: "ANULAR",
          fingerprint: preview.fingerprint,
        }),
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
  const result = await responses.find((r) => r.status === 200)!.json();
  await request(
    path,
    {
      reason: "Reintento QA",
      confirmation: "ANULAR",
      fingerprint: preview.fingerprint,
    },
    404,
  );
  return result.data;
}

async function balances() {
  const [row] = await sql!`
    select
      (select coalesce(sum(quantity),0)::float from stock_movements where product_id=${productId}) as stock,
      (select coalesce(sum(debit_cents-credit_cents),0)::float from current_account_entries where party_id=${customerId}) as debt,
      (select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::float from cash_movements where cash_account_id=${cashAccountId}) as cash
  `;
  const [level] =
    await sql!`select quantity::float as quantity from stock_levels where product_id=${productId} and warehouse_id=${warehouseId}`;
  expect(level.quantity).toBe(row.stock);
  return { stock: row.stock, debt: row.debt, cash: row.cash };
}

/** Comprueba la recuperación con claves foráneas reales y revierte todo al terminar. */
async function verifyBackupRestore(backup: Record<string, unknown>) {
  const rollback = new Error("QA: rollback de recuperación verificada");
  const company = backup.company as { id: string };
  try {
    await sql!.begin(async (tx) => {
      const actualTables = await tx<
        { name: string }[]
      >`select tablename as name from pg_tables where schemaname='public'`;
      const allowed = new Set(actualTables.map((row) => row.name));
      const records = new Map<string, unknown[]>([
        ["companies", [backup.company]],
      ]);
      for (const [key, value] of Object.entries(backup))
        if (allowed.has(key) && Array.isArray(value)) records.set(key, value);
      const references = await tx<
        { child: string; parent: string }[]
      >`select child.relname as child,parent.relname as parent from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid join pg_namespace n on n.oid=child.relnamespace where c.contype='f' and n.nspname='public'`;
      const pending = new Set(records.keys());
      while (pending.size) {
        const table = [...pending].find((candidate) =>
          references.every(
            (ref) =>
              ref.child !== candidate ||
              ref.parent === candidate ||
              !pending.has(ref.parent),
          ),
        );
        if (!table)
          throw new Error(
            "Dependencias circulares no soportadas por la recuperación de QA",
          );
        const rows = records.get(table)!;
        const quoted = `public."${table.replaceAll('"', '""')}"`;
        if (rows.length)
          await tx.unsafe(
            `insert into ${quoted} select * from jsonb_populate_recordset(null::${quoted},$1::text::jsonb)${table === "company_points_of_sale" ? " on conflict do nothing" : ""}`,
            [JSON.stringify(rows)],
          );
        pending.delete(table);
      }
      for (const [table, rows] of records) {
        const quoted = `public."${table.replaceAll('"', '""')}"`;
        const condition =
          table === "companies"
            ? "id=$1::uuid"
            : table === "role_permissions"
              ? "role_id in (select id from public.roles where company_id=$1::uuid)"
              : table === "import_rows"
                ? "job_id in (select id from public.import_jobs where company_id=$1::uuid)"
                : "company_id=$1::uuid";
        const actual = await tx.unsafe(
          `select to_jsonb(t) as data from ${quoted} t where ${condition}`,
          [company.id],
        );
        expect(
          actual.map((row) => JSON.stringify(row.data)).sort(),
          `Recuperación completa de ${table}`,
        ).toEqual(rows.map((row) => JSON.stringify(row)).sort());
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  expect(
    await sql!`select id from companies where id=${company.id}`,
  ).toHaveLength(0);
}

function draft(paymentMethod: string, quantity = 2, sourceDocumentId?: string) {
  return {
    kind: "venta",
    documentTypeId: sourceDocumentId ? creditType : invoiceType,
    partyId: customerId,
    issuedOn: new Date().toISOString().slice(0, 10),
    paymentMethod,
    warehouseId,
    cashAccountId,
    sourceDocumentId,
    lines: [{ productId, quantity, unitPriceCents: 10_000, discountBps: 0 }],
  };
}

describe.skipIf(!enabled)(
  "circuitos HTTP con PostgreSQL aislado y servidor de producción",
  () => {
    beforeAll(async () => {
      const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), {
        max: 1,
      });
      try {
        await root.unsafe(`create database ${database}`);
      } finally {
        await root.end();
      }
      const env = {
        ...process.env,
        DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database),
        DATABASE_URL: urlFor("DATABASE_URL", database),
      };
      for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
        execFileSync(process.execPath, ["--import", "tsx", script], {
          env,
          stdio: "pipe",
          timeout: 120_000,
        });
      }
      sql = postgres(env.DATABASE_URL_ADMIN, { max: 1 });
      [{ id: companyId }] =
        await sql`select id from companies where slug='distribuidora-parana'`;
      [{ id: warehouseId }] =
        await sql`select id from warehouses where company_id=${companyId} and is_default=true`;
      [{ id: invoiceType }] =
        await sql`select id from document_types where company_id=${companyId} and code='FAC'`;
      [{ id: creditType }] =
        await sql`select id from document_types where company_id=${companyId} and code='NCR'`;
      const cash =
        await sql`insert into cash_accounts(company_id,name,kind) values(${companyId},'QA circuitos','caja') returning id`;
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
          if (!address || typeof address === "string")
            return reject(new Error("Sin puerto"));
          listener.close(() => resolve(address.port));
        });
      });
      base = `http://127.0.0.1:${port}`;
      server = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      server.stdout?.on("data", (data) => {
        log = (log + data).slice(-12_000);
      });
      server.stderr?.on("data", (data) => {
        log = (log + data).slice(-12_000);
      });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          ready = (await fetch(`${base}/api/health`)).ok;
        } catch {
          /* Wait for startup. */
        }
        if (ready) break;
        if (server.exitCode !== null) throw new Error(log);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(ready, log).toBe(true);
      await request("auth/login", {
        email: "laura@talon.demo",
        password: "talon1234",
      });
      await request("auth/empresa", { companyId });
    }, 180_000);

    afterAll(async () => {
      if (server && server.exitCode === null) {
        const exited = new Promise<void>((resolve) =>
          server!.once("exit", () => resolve()),
        );
        server.kill("SIGKILL");
        await exited;
      }
      await sql?.end();
      const root = postgres(urlFor("DATABASE_URL_ADMIN", "postgres"), {
        max: 1,
      });
      try {
        await root.unsafe(`drop database if exists ${database} with (force)`);
      } finally {
        await root.end();
      }
    }, 20_000);

    it("venta a cuenta, cobro parcial, anulación del recibo y de la venta restauran los tres saldos", async () => {
      const initial = await balances();
      const sale = await request("documentos", draft("cuenta_corriente"));
      expect(sale.totalCents).toBe(24_200);
      const persisted = await request(`documentos/${sale.id}`);
      expect(persisted.totalCents).toBe(24_200);
      expect(persisted.status).toBe("confirmado");
      expect(persisted.lines).toHaveLength(1);
      expect(await balances()).toEqual({
        ...initial,
        stock: initial.stock - 2,
        debt: initial.debt + 24_200,
      });
      const receipt = await request("cuentas/cobro", {
        partyType: "customer",
        partyId: customerId,
        cashAccountId,
        amountCents: 10_000,
        description: "Recibo QA",
        occurredOn: new Date().toISOString().slice(0, 10),
      });
      expect(await balances()).toEqual({
        stock: initial.stock - 2,
        debt: initial.debt + 14_200,
        cash: initial.cash + 10_000,
      });
      await request(`documentos/${receipt.id}/anular`, {
        reason: "QA reversión",
      });
      await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
      expect(await balances()).toEqual(initial);
      await request(`documentos/${sale.id}/anular`, {}, 400);
      expect(await balances()).toEqual(initial);
    });

    it("venta al contado y nota de crédito reintegran caja y stock; impide exceder lo facturado", async () => {
      const initial = await balances();
      const sale = await request("documentos", draft("contado"));
      expect(sale.totalCents).toBe(24_200);
      expect(await balances()).toEqual({
        stock: initial.stock - 2,
        debt: initial.debt,
        cash: initial.cash + 24_200,
      });
      await request("documentos", draft("contado", 2, sale.id));
      expect(await balances()).toEqual(initial);
      await request("documentos", draft("contado", 1, sale.id), 409);
      expect(await balances()).toEqual(initial);
    });

    it("stock insuficiente revierte la transacción completa", async () => {
      const initial = await balances();
      const [before] =
        await sql!`select count(*)::int as count from documents where party_id=${customerId}`;
      await request("documentos", draft("contado", 1_000), 409);
      expect(await balances()).toEqual(initial);
      const [after] =
        await sql!`select count(*)::int as count from documents where party_id=${customerId}`;
      expect(after.count).toBe(before.count);
    });

    it("dos notas de crédito simultáneas no pueden acreditar más que la factura", async () => {
      const initial = await balances();
      const sale = await request("documentos", draft("cuenta_corriente"));
      const responses = await Promise.all(
        [1, 2].map(() =>
          fetch(`${base}/api/documentos`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify(draft("cuenta_corriente", 1.5, sale.id)),
            signal: AbortSignal.timeout(20_000),
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(await balances()).toEqual({
        stock: initial.stock - 0.5,
        debt: initial.debt + 6_050,
        cash: initial.cash,
      });
      const credit = await responses
        .find((response) => response.status === 200)!
        .json();
      await request(`documentos/${credit.data.id}/anular`, {
        reason: "QA reversión",
      });
      await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
      expect(await balances()).toEqual(initial);
    });

    it("un contador no puede emitir ni anular, y otra empresa no puede leer la venta", async () => {
      const initial = await balances();
      const sale = await request("documentos", draft("cuenta_corriente"));
      const adminCookie = cookie;
      try {
        cookie = "";
        await request("auth/login", {
          email: "hector@talon.demo",
          password: "talon1234",
        });
        await request("auth/empresa", { companyId });
        await request(`documentos/${sale.id}`);
        await request("documentos", draft("contado"), 403);
        await request(`documentos/${sale.id}/anular`, {}, 403);
        cookie = adminCookie;
        const [other] =
          await sql!`select id from companies where slug='costa-servicios'`;
        await request("auth/empresa", { companyId: other.id });
        await request(`documentos/${sale.id}`, undefined, 404);
      } finally {
        cookie = adminCookie;
      }
      await request(`documentos/${sale.id}/anular`, { reason: "QA reversión" });
      expect(await balances()).toEqual(initial);
    });
    it("alta, numeradores por punto, vaciado con respaldo y eliminación aislados", async () => {
      const protectedBefore =
        await sql!`select count(*)::int as count from documents where company_id=${companyId}`;
      const input = {
        name: "Empresa QA nueva",
        legalName: "Empresa QA SRL",
        cuit: "30-71458901-6",
        taxCondition: "ri",
        address: "Domicilio ficticio 123",
        activityStartedOn: "2026-01-01",
        businessSector: "comercio",
        pointsOfSale: [1, 2],
        basicLedger: true,
        enabledModules: [
          "clientes",
          "ventas",
          "stock",
          "caja",
          "cuentas_corrientes",
          "comprobantes",
          "auditoria",
        ],
      };
      // Sólo el fixture concede el permiso global: ser admin de un tenant no alcanza.
      const { buildCuit } = await import("../fiscal/cuit");
      input.cuit = buildCuit("30", "67458901");
      expect((await request("empresas/capacidades")).canCreate).toBe(false);
      await request("empresas", input, 403);
      await sql!`insert into company_operators(user_id,scope) select id,'estudio' from users where email='laura@talon.demo'`;
      await request("empresas", { ...input, cuit: "123" }, 400);
      await request("empresas", { ...input, pointsOfSale: [1, 1] }, 400);
      await request("empresas", { ...input, enabledModules: [] }, 400);
      const attempts=await Promise.all([0,1].map(()=>fetch(`${base}/api/empresas`, {
        method:"POST", headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify(input)
      })));
      expect(attempts.map(r=>r.status).sort()).toEqual([200,409]);
      const created=(await attempts.find(r=>r.status===200)!.json()).data;
      await request("auth/empresa",{companyId:created.id});
      await request("empresas", { ...input, cuit: input.cuit.replaceAll("-", "") }, 409);
      const me = await request("auth/me");
      expect(me.company.id).toBe(created.id);
      expect(me.role.key).toBe("admin");
      const catalog = await request("catalogos");
      expect(catalog.pointsOfSale).toEqual([1, 2]);
      expect(catalog.cashAccounts).toHaveLength(1);
      const roleConfig = await request("configuracion");
      const seller = roleConfig.roles.find(
        (role: { key: string }) => role.key === "vendedor",
      );
      const permissions = seller.permissions.filter(
        (permission: string) => permission !== "ventas.anular",
      );
      const editedRole = await fetch(`${base}/api/roles/${seller.id}`, {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: seller.name,
          description: seller.description,
          permissions,
        }),
      });
      expect(editedRole.status).toBe(200);
      expect((await editedRole.json()).data.permissions).not.toContain(
        "ventas.anular",
      );
      // Modo estudio desde el alta: sólo Impuestos, el creador queda como Contador.
      const estudio = (await request("empresas", { ...input, name: "Estudio QA", legalName: "Estudio QA SRL", cuit: buildCuit("30", "67458902"), tipo: "estudio", enabledModules: ["ventas", "stock"] })) as { id: string };
      await request("auth/empresa", { companyId: estudio.id });
      const estudioMe = await request("auth/me");
      expect(estudioMe.role.key).toBe("contador");
      expect(estudioMe.company.modules).toEqual(["impuestos"]);
      const [estudioRow] = await sql!`select tipo from companies where id=${estudio.id}`;
      expect(estudioRow.tipo).toBe("estudio");
      await request("clientes", undefined, 403);
      await request("auth/empresa", { companyId: created.id });
      execFileSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
        env: {
          ...process.env,
          DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database),
          DATABASE_URL: urlFor("DATABASE_URL", database),
        },
        stdio: "pipe",
        timeout: 120_000,
      });
      expect(
        (await request("configuracion")).roles.find(
          (role: { id: string }) => role.id === seller.id,
        ).permissions,
      ).not.toContain("ventas.anular");
      const customer = await request("clientes", {
        name: "Cliente nuevo",
        taxCondition: "ri",
      });
      const invoiceType = catalog.documentTypes.find(
        (item: { code: string }) => item.code === "FAC",
      ).id;
      const draft = (pointOfSale: number) => ({
        kind: "venta",
        partyId: customer.id,
        documentTypeId: invoiceType,
        pointOfSale,
        issuedOn: "2026-10-21",
        paymentMethod: "cuenta_corriente",
        lines: [
          { description: "Servicio QA", quantity: 1, unitPriceCents: 10_000 },
        ],
      });
      const first = await request("documentos", draft(1));
      const second = await request("documentos", draft(2));
      const third = await request("documentos", draft(1));
      expect([first.number, second.number, third.number]).toEqual([1, 1, 2]);
      expect([first.pointOfSale, second.pointOfSale]).toEqual([1, 2]);
      await request("documentos", draft(99), 400);
      await request(
        `empresas/${created.id}/vaciar`,
        { confirmation: "incorrecto" },
        400,
      );
      // No se puede administrar otra empresa sin seleccionarla.
      await request(
        `empresas/${companyId}/vaciar`,
        { confirmation: "Distribuidora Paraná" },
        403,
      );
      const ownerCookie = cookie;
      cookie = "";
      await request("auth/login", {
        email: "mateo@talon.demo",
        password: "talon1234",
      });
      await request(
        `empresas/${companyId}/vaciar`,
        { confirmation: "Distribuidora Paraná" },
        403,
      );
      cookie = ownerCookie;
      // Simula una referencia antigua inconsistente: ni CASCADE puede borrar otra empresa.
      const poisonedId = randomUUID();
      await sql!`insert into document_lines(id,company_id,document_id,position,product_id,sku,description,quantity,unit_price_cents,discount_bps,iva_rate_bps,tax_treatment,net_cents,vat_cents,exempt_cents,untaxed_cents,total_cents) select ${poisonedId},${companyId},document_id,position,product_id,sku,description,quantity,unit_price_cents,discount_bps,iva_rate_bps,tax_treatment,net_cents,vat_cents,exempt_cents,untaxed_cents,total_cents from document_lines where document_id=${first.id} limit 1`;
      await request(
        `empresas/${created.id}/vaciar`,
        { confirmation: input.name },
        403,
      );
      expect(
        await sql!`select id from document_lines where id=${poisonedId}`,
      ).toHaveLength(1);
      expect((await request("empresas/respaldos")).items).toHaveLength(0);
      await sql!`delete from document_lines where id=${poisonedId}`;
      const writerDb = postgres(urlFor("DATABASE_URL", database), { max: 1 });
      let releaseWriter!: () => void;
      let writerReady!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        writerReady = resolve;
      });
      const writer = writerDb.begin(async (tx) => {
        await tx`select set_config('app.company_id',${created.id},true),set_config('app.user_id',(select id::text from auth_find_user('laura@talon.demo')),true)`;
        await tx`update customers set name='Cliente actualizado antes del respaldo' where id=${customer.id}`;
        writerReady();
        await released;
      });
      await Promise.race([ready, writer]);
      const wiping = request(`empresas/${created.id}/vaciar`, {
        confirmation: input.name,
      });
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const [row] =
            await sql!`select exists(select 1 from pg_stat_activity where datname=${database} and query like '%company_destroy%' and wait_event='advisory') as waiting`;
          if (row.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
      } finally {
        releaseWriter();
        await writer;
        await writerDb.end();
      }
      const wiped = await wiping;
      const backupResponse = await fetch(`${base}${wiped.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      expect(backupResponse.status).toBe(200);
      const backup = await backupResponse.json();
      expect(backup.documents).toHaveLength(3);
      expect(backup.customers).toHaveLength(1);
      expect(backup.customers[0].name).toBe(
        "Cliente actualizado antes del respaldo",
      );
      expect(backup.role_permissions.length).toBeGreaterThan(0);
      expect(JSON.stringify(backup)).not.toContain("password_hash");
      const [counts] =
        await sql!`select (select count(*)::int from documents where company_id=${created.id}) as documents,(select count(*)::int from customers where company_id=${created.id}) as customers`;
      expect(counts).toMatchObject({ documents: 0, customers: 1 });
      const next = await request("documentos", draft(1));
      expect(next.number).toBe(3); // Vaciar no reutiliza números emitidos.
      const deleted = await request(`empresas/${created.id}/eliminar`, {
        confirmation: input.name,
      });
      const afterDelete = await fetch(`${base}${deleted.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      expect(afterDelete.status).toBe(200);
      expect((await afterDelete.json()).documents).toHaveLength(1);
      expect((await request("empresas/respaldos")).items).toHaveLength(2);
      expect(
        await sql!`select id from companies where id=${created.id}`,
      ).toHaveLength(0);
      await verifyBackupRestore(backup);
      const protectedAfter =
        await sql!`select count(*)::int as count from documents where company_id=${companyId}`;
      expect(protectedAfter[0].count).toBe(protectedBefore[0].count);
      await request("auth/empresa", { companyId });
    }, 30_000);

    it("inmobiliaria: alquiler, recibo, comisión y pago sin duplicar caja; ajuste y aislamiento", async () => {
      const { buildCuit } = await import("../fiscal/cuit");
      const created = await request("empresas", {
        name: "Inmobiliaria QA",
        legalName: "Inmobiliaria QA SRL",
        cuit: buildCuit("30", "67891234"),
        taxCondition: "ri",
        address: "Prueba 123",
        activityStartedOn: "2026-01-01",
        businessSector: "inmobiliaria",
        pointsOfSale: [1],
        enabledModules: [
          "inmobiliaria",
          "clientes",
          "proveedores",
          "ventas",
          "caja",
          "cuentas_corrientes",
          "comprobantes",
          "auditoria",
        ],
      });
      const owner = await request("clientes", {
        name: "Propietario QA",
        taxCondition: "ri",
      });
      const tenant = await request("clientes", {
        name: "Inquilino QA",
        taxCondition: "cf",
      });
      const ownerSupplier = await request("proveedores", {
        name: "Propietario QA",
        taxCondition: "ri",
      });
      const property = await request("inmobiliaria/propiedades", {
        address: "Propiedad QA 123",
        kind: "depto",
        ownerCustomerId: owner.id,
        ownerSupplierId: ownerSupplier.id,
      });
      const contract = await request("inmobiliaria/contratos", {
        propertyId: property.id,
        tenantId: tenant.id,
        startsOn: "2026-01-01",
        endsOn: "2027-12-31",
        initialRentCents: 10_000_000,
        adjustmentMethod: "fijo",
        adjustmentMonths: 3,
        fixedAdjustmentBps: 1000,
        commissionBps: 1000,
        commissionVatBps: 2100,
        dueDay: 10,
      });
      const charge = await request("inmobiliaria/liquidaciones", {
        contractId: contract.id,
        period: "2026-01",
        expensesCents: 200_000,
        asOf: "2026-01-10",
      });
      expect(charge).toMatchObject({
        rentCents: 10_000_000,
        extrasCents: 200_000,
        penaltyCents: 0,
      });
      await request(
        "inmobiliaria/liquidaciones",
        { contractId: contract.id, period: "2026-01", asOf: "2026-01-10" },
        409,
      );
      const catalog = await request("catalogos");
      const cashId = catalog.cashAccounts[0].id;
      const receipt = await request(
        `inmobiliaria/liquidaciones/${charge.id}/cobrar`,
        {
          rentCents: 10_000_000,
          extrasCents: 200_000,
          cashAccountId: cashId,
          occurredOn: "2026-01-10",
        },
      );
      await request(
        `inmobiliaria/liquidaciones/${charge.id}/cobrar`,
        {
          rentCents: 1,
          extrasCents: 0,
          cashAccountId: cashId,
          occurredOn: "2026-01-10",
        },
        409,
      );
      // Cambiar condiciones no cambia la comisión del cobro ya registrado.
      const conditionResponse = await fetch(
        `${base}/api/inmobiliaria/contratos/${contract.id}/condiciones`,
        {
          method: "PATCH",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            commissionBps: 2000,
            commissionVatBps: 2100,
            lateDailyBps: 0,
            graceDays: 0,
          }),
        },
      );
      expect(conditionResponse.status).toBe(200);
      const settlement = await request("inmobiliaria/propietarios", {
        receiptId: receipt.id,
        occurredOn: "2026-01-10",
      });
      expect(settlement).toMatchObject({
        commission: 1_000_000,
        totalCommission: 1_210_000,
        payable: 8_990_000,
      });
      await request(
        "inmobiliaria/propietarios",
        { receiptId: receipt.id, occurredOn: "2026-01-10" },
        409,
      );
      await request(`documentos/${receipt.documentId}/anular`, {}, 409);
      await request(`documentos/${settlement.invoiceId}/anular`, {}, 409);
      await request(`inmobiliaria/propietarios/${settlement.id}/pagar`, {
        cashAccountId: cashId,
        occurredOn: "2026-01-10",
      });
      await request(
        `inmobiliaria/propietarios/${settlement.id}/pagar`,
        { cashAccountId: cashId, occurredOn: "2026-01-10" },
        409,
      );
      const [totals] =
        await sql!`select (select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::float from cash_movements where company_id=${created.id}) as cash,(select coalesce(sum(debit_cents-credit_cents),0)::float from current_account_entries where party_id=${tenant.id}) as tenant,(select coalesce(sum(debit_cents-credit_cents),0)::float from current_account_entries where party_id=${owner.id}) as owner,(select coalesce(sum(debit_cents-credit_cents),0)::float from current_account_entries where party_id=${ownerSupplier.id}) as supplier`;
      expect(totals).toMatchObject({
        cash: 1_210_000,
        tenant: 0,
        owner: 0,
        supplier: 0,
      });
      const [spent] =
        await sql!`insert into cash_movements(company_id,cash_account_id,direction,amount_cents,description,occurred_on) values(${created.id},${cashId},'out',1210000,'Fixture QA para validar reversión sin saldo','2026-01-11') returning id`;
      await request(
        `reversiones/inmobiliaria/cobros/${receipt.id}`,
        undefined,
        409,
      );
      expect((await request(`documentos/${receipt.documentId}`)).status).toBe(
        "confirmado",
      );
      await sql!`delete from cash_movements where id=${spent.id}`;
      await request(`inmobiliaria/contratos/${contract.id}/ajustar`, {
        effectiveOn: "2026-04-01",
        source: "Ajuste fijo pactado",
      });
      const adjusted = await request("inmobiliaria/liquidaciones", {
        contractId: contract.id,
        period: "2026-04",
        asOf: "2026-04-10",
      });
      expect(adjusted.rentCents).toBe(11_000_000);
      const file = await request("inmobiliaria/adjuntos", {
        propertyId: property.id,
        filename: "prueba.pdf",
        mime: "application/pdf",
        contentBase64: Buffer.from("%PDF-1.4\nQA").toString("base64"),
      });
      const download = await fetch(
        `${base}/api/inmobiliaria/adjuntos/${file.id}`,
        { headers: { Cookie: cookie } },
      );
      expect(download.status).toBe(200);
      expect(await download.text()).toContain("%PDF");
      const app = postgres(urlFor("DATABASE_URL", database), { max: 1 });
      try {
        await app.begin(async (tx) => {
          await tx`select set_config('app.company_id',${companyId},true),set_config('app.user_id',(select id::text from auth_find_user('laura@talon.demo')),true)`;
          expect(
            await tx`select id from estate_properties where id=${property.id}`,
          ).toHaveLength(0);
        });
      } finally {
        await app.end();
      }
      await request("auth/empresa", { companyId });
      await request("inmobiliaria/propiedades", undefined, 403);
      await request("auth/empresa", { companyId: created.id });
      const wipe = await request(`empresas/${created.id}/vaciar`, {
        confirmation: "Inmobiliaria QA",
      });
      const backed = await fetch(`${base}${wipe.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      const snapshot = await backed.json();
      expect(snapshot.estate_receipts).toHaveLength(1);
      expect(snapshot.estate_settlements).toHaveLength(1);
      expect(snapshot.estate_attachments).toHaveLength(1);
      expect((await request("inmobiliaria/propiedades")).items).toHaveLength(1);
      expect((await request("inmobiliaria/liquidaciones")).items).toHaveLength(
        0,
      );
      await request(`empresas/${created.id}/eliminar`, {
        confirmation: "Inmobiliaria QA",
      });
      await verifyBackupRestore(snapshot);
      await request(`empresas/respaldos/${wipe.backupId}/restaurar`, {
        confirmation: "Inmobiliaria QA",
      });
      const [beforePreview] =
        await sql!`select count(*)::int as n from documents where company_id=${created.id} and status='anulado'`;
      const effect = await reverseOperation(
        "inmobiliaria",
        "cobros",
        receipt.id,
      );
      expect(effect).toMatchObject({
        documentCount: 2,
        cashDeltaCents: -1210000,
        operationCount: 2,
      });
      const [reversed] =
        await sql!`select (select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::int from cash_movements where company_id=${created.id}) as cash,(select coalesce(sum(debit_cents-credit_cents),0)::int from current_account_entries where party_id=${owner.id}) as owner,(select coalesce(sum(debit_cents-credit_cents),0)::int from current_account_entries where party_id=${ownerSupplier.id}) as supplier,(select count(*)::int from documents where company_id=${created.id} and status='anulado') as voided`;
      expect(reversed).toEqual({
        cash: 0,
        owner: 0,
        supplier: 0,
        voided: beforePreview.n + 2,
      });
      expect(
        (await request("inmobiliaria/liquidaciones")).items.find(
          (r: { id: string }) => r.id === charge.id,
        ),
      ).toBeTruthy();
      await request(`empresas/${created.id}/eliminar`, {
        confirmation: "Inmobiliaria QA",
      });
      await request("auth/empresa", { companyId });
    }, 30_000);

    it("el administrador de su última empresa vuelve a entrar y descarga su respaldo, sin acceso ajeno", async () => {
      const { buildCuit } = await import("../fiscal/cuit");
      const created = await request("empresas", {
        name: "Última empresa QA",
        legalName: "Última empresa QA",
        cuit: buildCuit("30", "67654321"),
        taxCondition: "ri",
        address: "Prueba 1",
        activityStartedOn: "2026-01-01",
        businessSector: "comercio",
        pointsOfSale: [1],
        enabledModules: ["clientes", "ventas", "caja", "cuentas_corrientes"],
      });
      const config = await request("configuracion");
      const adminRole = config.roles.find(
        (role: { key: string }) => role.key === "admin",
      );
      await request("usuarios", {
        name: "Administrador único QA",
        email: "ultimo@talon.demo",
        password: "demoQA1234",
        roleId: adminRole.id,
      });
      const lauraCookie = cookie;
      cookie = "";
      await request("auth/login", {
        email: "ultimo@talon.demo",
        password: "demoQA1234",
      });
      const deleted = await request(`empresas/${created.id}/eliminar`, {
        confirmation: "Última empresa QA",
      });
      await request("auth/logout", {});
      expect(
        await request("auth/login", {
          email: "ultimo@talon.demo",
          password: "demoQA1234",
        }),
      ).toEqual({ backupOnly: true });
      expect((await request("empresas/respaldos")).items).toHaveLength(1);
      const own = await fetch(`${base}${deleted.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      expect(own.status).toBe(200);
      await request("auth/me", undefined, 401);
      await sql!`insert into company_operators(user_id,scope) select id,'estudio' from users where email='ultimo@talon.demo'`;
      await request("auth/logout", {});
      expect(
        await request("auth/login", {
          email: "ultimo@talon.demo",
          password: "demoQA1234",
        }),
      ).toEqual({ companySetupOnly: true });
      expect((await request("empresas/capacidades")).canCreate).toBe(true);
      const restart = await request("empresas", {
        name: "Primera empresa QA",
        legalName: "Primera empresa QA",
        cuit: buildCuit("30", "67654322"),
        taxCondition: "ri",
        address: "Prueba 2",
        activityStartedOn: "2026-01-01",
        businessSector: "comercio",
        pointsOfSale: [1],
        enabledModules: ["clientes", "ventas"],
      });
      expect((await request("auth/me")).company.id).toBe(restart.id);
      await request(`empresas/${restart.id}/eliminar`, {
        confirmation: "Primera empresa QA",
      });
      cookie = lauraCookie;
      const foreign = await fetch(`${base}${deleted.downloadUrl}`, {
        headers: { Cookie: cookie },
      });
      expect(foreign.status).toBe(404);
      await request("auth/empresa", { companyId });
    }, 30_000);
    it("un recibo no vuelve a cobrar la percepción IIBB ya incluida en la factura", async () => {
      const party = await request("clientes", {
        name: "QA · RI con IIBB",
        taxCondition: "ri",
        iibbPerceptionBps: 300,
      });
      const sale = await request("documentos", {
        kind: "venta",
        documentTypeId: invoiceType,
        partyId: party.id,
        issuedOn: "2026-10-21",
        paymentMethod: "cuenta_corriente",
        lines: [
          { description: "Servicio QA", quantity: 1, unitPriceCents: 10000 },
        ],
      });
      expect(sale.totalCents).toBe(12400);
      const receipt = await request("cuentas/cobro", {
        partyType: "customer",
        partyId: party.id,
        cashAccountId,
        amountCents: 12400,
        description: "Recibo",
        occurredOn: "2026-10-21",
      });
      const saved = await request(`documentos/${receipt.id}`);
      expect(saved.totalCents).toBe(12400);
      const [balance] =
        await sql!`select sum(debit_cents-credit_cents)::float as cents from current_account_entries where party_id=${party.id}`;
      expect(balance.cents).toBe(0);
    });

    it("constructora: cantidades, CAC, anticipo, reparo, stock, costos y cuotas aislados", async () => {
      const { buildCuit } = await import("../fiscal/cuit");
      const company = await request("empresas", {
        name: "Constructora QA",
        legalName: "Constructora QA SRL",
        cuit: buildCuit("30", "67981234"),
        taxCondition: "ri",
        address: "Prueba obra 1",
        activityStartedOn: "2026-01-01",
        businessSector: "constructora",
        pointsOfSale: [1],
        enabledModules: [
          "constructora",
          "clientes",
          "proveedores",
          "articulos",
          "compras",
          "ventas",
          "stock",
          "remitos",
          "caja",
          "cuentas_corrientes",
          "comprobantes",
          "auditoria",
        ],
      });
      const client = await request("clientes", {
        name: "Cliente obra QA",
        taxCondition: "ri",
        discountBps: 1000,
      });
      const supplier = await request("proveedores", {
        name: "Subcontratista QA",
        taxCondition: "ri",
      });
      const w = await request("constructora/obras", {
        name: "Obra QA",
        customerId: client.id,
        location: "Ubicación ficticia",
        responsible: "Responsable QA",
        startsOn: "2026-01-01",
        endsOn: "2027-12-31",
        cacBaseMonth: "2026-01",
        cacBaseIndex: 100,
        repairBps: 500,
        vatBps: 2100,
      });
      const item = await request("constructora/items", {
        workId: w.id,
        rubro: "Estructura",
        description: "Ítem medido",
        kind: "material",
        quantity: 8,
        unitPriceCents: 10000,
      });
      const global = await request("constructora/items", {
        workId: w.id,
        rubro: "Instalación",
        description: "Ítem global",
        kind: "mano_obra",
        quantity: 1,
        unitPriceCents: 20000,
        global: true,
      });
      const catalog = await request("catalogos");
      const cashId = catalog.cashAccounts[0].id;
      const advance = await request("constructora/anticipos", {
        workId: w.id,
        amountCents: 10000,
        cashAccountId: cashId,
        occurredOn: "2026-01-01",
      });
      expect(advance.totalCents).toBe(12100);
      const [advanceTax] =
        await sql!`select vat_cents,total_cents from documents where id=${advance.invoiceId}`;
      expect(Number(advanceTax.vat_cents)).toBe(2100);
      const [initialAccount] =
        await sql!`select sum(debit_cents-credit_cents)::int as balance from current_account_entries where party_id=${client.id}`;
      expect(initialAccount.balance).toBe(0);
      const certificate = (period: string, quantity: number, bps: number) => ({
        workId: w.id,
        period,
        issuedOn: `${period}-28`,
        cacMonth: period,
        cacIndex: 120,
        cacSource: "Índice ficticio de prueba",
        items: [
          { itemId: item.id, cumulativeQuantity: quantity },
          { itemId: global.id, cumulativeBps: bps },
        ],
      });
      const input = certificate("2026-01", 2, 0);
      const preview = await request("constructora/previsualizacion", input);
      expect(preview).toMatchObject({
        periodBaseCents: 20000,
        adjustmentCents: 4000,
        advanceReturnedCents: 2000,
        repairCents: 1200,
        taxBaseCents: 22000,
        vatCents: 4620,
        totalCents: 26620,
        progressBps: 2000,
      });
      const first = await request("constructora/certificados", input);
      expect(first.totalCents).toBe(26620);
      await request(
        "constructora/anticipos",
        {
          workId: w.id,
          amountCents: 1,
          cashAccountId: cashId,
          occurredOn: "2026-01-30",
        },
        409,
      );
      await request("constructora/certificados", input, 409);
      await request(
        "constructora/certificados",
        certificate("2026-02", 9, 0),
        400,
      );
      await request(`documentos/${first.documentId}/anular`, {}, 409);
      await request(`reversiones/constructora/constructor/${first.id}`,undefined,404);
      const stalePreview = await request(
        `reversiones/constructora/certificados/${first.id}`,
      );
      await request(`constructora/certificados/${first.id}/cobrar`, {
        amountCents: 25420,
        cashAccountId: cashId,
        occurredOn: "2026-01-29",
      });
      await request(
        `constructora/certificados/${first.id}/cobrar`,
        { amountCents: 1, cashAccountId: cashId, occurredOn: "2026-01-29" },
        409,
      );
      await request(
        `reversiones/constructora/certificados/${first.id}`,
        {
          reason: "Vista previa vencida",
          confirmation: "ANULAR",
          fingerprint: stalePreview.fingerprint,
        },
        409,
      );
      const [afterFirst] =
        await sql!`select sum(debit_cents-credit_cents)::int as balance from current_account_entries where party_id=${client.id}`;
      expect(afterFirst.balance).toBe(1200);
      const detail = await request(`constructora/certificados/${first.id}`);
      expect(detail.lines).toHaveLength(2);
      expect(Number(detail.certificate.adjustment_cents)).toBe(4000);
      const second = await request(
        "constructora/certificados",
        certificate("2026-02", 3, 5000),
      );
      expect(second.periodBaseCents).toBe(20000);
      expect(second.totalCents).toBe(26620);
      await request(
        "constructora/items",
        {
          workId: w.id,
          rubro: "Extra",
          description: "No aprobado",
          kind: "material",
          quantity: 1,
          unitPriceCents: 1000,
        },
        409,
      );
      const extra = await request("constructora/items", {
        workId: w.id,
        rubro: "Extra",
        description: "Ampliación",
        kind: "material",
        quantity: 1,
        unitPriceCents: 1000,
        additional: true,
      });
      const final = await request("constructora/certificados", {
        ...certificate("2026-03", 8, 10000),
        items: [
          { itemId: item.id, cumulativeQuantity: 8 },
          { itemId: global.id, cumulativeBps: 10000 },
          { itemId: extra.id, cumulativeQuantity: 1 },
        ],
      });
      expect(final).toMatchObject({
        periodBaseCents: 61000,
        advanceReturnedCents: 6000,
        repairCents: 3660,
        totalCents: 81312,
        progressBps: 10000,
      });
      const patch = await fetch(`${base}/api/constructora/obras/${w.id}`, {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "finalizada" }),
      });
      expect(patch.status).toBe(200);
      const [beforeRelease] =
        await sql!`select count(*)::int as n from documents where party_id=${client.id}`;
      await request(`constructora/obras/${w.id}/liberar-reparo`, {
        occurredOn: "2026-04-01",
      });
      await request(
        `constructora/obras/${w.id}/liberar-reparo`,
        { occurredOn: "2026-04-01" },
        409,
      );
      const [finalAccount] =
        await sql!`select sum(debit_cents-credit_cents)::int as balance from current_account_entries where party_id=${client.id}`;
      expect(finalAccount.balance).toBe(109132);
      const [afterRelease] =
        await sql!`select count(*)::int as n from documents where party_id=${client.id}`;
      expect(afterRelease.n).toBe(beforeRelease.n);
      await request(`constructora/certificados/${first.id}/cobrar`, {
        amountCents: 1200,
        cashAccountId: cashId,
        occurredOn: "2026-04-01",
      });
      const product = await request("articulos", {
        sku: "QA-OBRA",
        name: "Material QA",
        ivaRateBps: 2100,
        costCents: 1000,
      });
      const origin = catalog.warehouses.find(
        (item: { isDefault: boolean }) => item.isDefault,
      ).id;
      await request("stock/ajustes", {
        productId: product.id,
        warehouseId: origin,
        direction: "in",
        quantity: 10,
        note: "QA apertura",
      });
      const transfer = await request("constructora/acopio", {
        workId: w.id,
        productId: product.id,
        fromWarehouseId: origin,
        quantity: 3,
        occurredOn: "2026-01-01",
      });
      expect(
        Number(
          (await request(`constructora/acopio?workId=${w.id}`)).items[0]
            .quantity,
        ),
      ).toBe(3);
      await request(`documentos/${transfer.documentId}/anular`, {});
      expect(
        Number(
          (await request(`constructora/acopio?workId=${w.id}`)).items[0]
            .quantity,
        ),
      ).toBe(0);
      await request("constructora/costos", {
        workId: w.id,
        kind: "mano_obra",
        description: "Horas ejecutadas",
        amountCents: 2000,
        occurredOn: "2026-01-01",
      });
      const subcontract = await request("constructora/subcontratos", {
        workId: w.id,
        supplierId: supplier.id,
        description: "Contrato QA",
        amountCents: 10000,
        retentionBps: 500,
      });
      expect(
        await request(
          `constructora/subcontratos/${subcontract.id}/certificar`,
          { period: "2026-01", amountCents: 1000, occurredOn: "2026-01-31" },
        ),
      ).toMatchObject({ retainedCents: 50 });
      await request(
        `constructora/subcontratos/${subcontract.id}/certificar`,
        { period: "2026-02", amountCents: 9001, occurredOn: "2026-02-28" },
        409,
      );
      const unit = await request("constructora/unidades", {
        workId: w.id,
        name: "Unidad QA",
        priceCents: 10000,
      });
      const buyer = await request("clientes", {
        name: "Comprador QA",
        taxCondition: "cf",
      });
      await request(`constructora/unidades/${unit.id}/vender`, {
        buyerId: buyer.id,
        priceCents: 10000,
        installments: 3,
        firstDueOn: "2026-01-31",
        adjustmentMethod: "CAC",
      });
      const quotas = (await request(`constructora/cuotas?workId=${w.id}`))
        .items;
      expect(
        quotas.map((q: { amount_cents: string }) => Number(q.amount_cents)),
      ).toEqual([3333, 3333, 3334]);
      expect(quotas.map((q: { due_on: string }) => q.due_on)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
      ]);
      await request(`constructora/cuotas/${quotas[0].id}/cobrar`, {
        amountCents: 1000,
        cashAccountId: cashId,
        occurredOn: "2026-01-31",
      });
      expect(
        await request(`constructora/cuotas/${quotas[0].id}/ajustar`, {
          coefficient: 1.1,
          source: "Índice ficticio QA",
          occurredOn: "2026-02-01",
        }),
      ).toMatchObject({ amountCents: 3566 });
      await request(
        `constructora/cuotas/${quotas[0].id}/ajustar`,
        { coefficient: 1.1, source: "Reintento", occurredOn: "2026-02-01" },
        409,
      );
      const [buyerBalance] =
        await sql!`select sum(debit_cents-credit_cents)::int as balance from current_account_entries where party_id=${buyer.id}`;
      expect(buyerBalance.balance).toBe(9233);
      const report = await request(`constructora/informes?workId=${w.id}`);
      expect(report.works).toHaveLength(1);
      expect(
        report.costs.reduce(
          (sum: number, r: { amount_cents: string }) =>
            sum + Number(r.amount_cents),
          0,
        ),
      ).toBe(3000);
      const app = postgres(urlFor("DATABASE_URL", database), { max: 1 });
      try {
        await app.begin(async (tx) => {
          await tx`select set_config('app.company_id',${companyId},true),set_config('app.user_id',(select id::text from auth_find_user('laura@talon.demo')),true)`;
          expect(
            await tx`select id from construction_works where id=${w.id}`,
          ).toHaveLength(0);
        });
      } finally {
        await app.end();
      }
      const wipe = await request(`empresas/${company.id}/vaciar`, {
        confirmation: "Constructora QA",
      });
      const snapshot = await (
        await fetch(`${base}${wipe.downloadUrl}`, {
          headers: { Cookie: cookie },
        })
      ).json();
      expect(snapshot.construction_certificates).toHaveLength(3);
      expect(snapshot.construction_items).toHaveLength(3);
      expect(
        (await request(`constructora/items?workId=${w.id}`)).items.every(
          (item: { certified_cents: string }) =>
            Number(item.certified_cents) === 0,
        ),
      ).toBe(true);
      await request(`empresas/${company.id}/eliminar`, {
        confirmation: "Constructora QA",
      });
      await verifyBackupRestore(snapshot);
      await request(`empresas/respaldos/${wipe.backupId}/restaurar`, {
        confirmation: "Constructora QA",
      });
      const operations = (await request("reversiones/constructora")).items as {
        id: string;
        resource: string;
      }[];
      const quotaReceipt = operations.find((r) => r.resource === "cuotas")!;
      await reverseOperation("constructora", "cuotas", quotaReceipt.id);
      const [quotaState] =
        await sql!`select paid_cents::int as paid from construction_installments where id=${quotas[0].id}`;
      expect(quotaState.paid).toBe(0);
      await request(
        `reversiones/constructora/certificados/${first.id}`,
        undefined,
        409,
      );
      const release = operations.find((r) => r.resource === "reparos")!;
      await request(
        `reversiones/constructora/reparos/${release.id}`,
        undefined,
        409,
      );
      for (const c of operations.filter((r) => r.resource === "cobros"))
        await reverseOperation("constructora", "cobros", c.id);
      await reverseOperation("constructora", "reparos", release.id);
      await reverseOperation("constructora", "certificados", final.id);
      await reverseOperation("constructora", "certificados", second.id);
      await reverseOperation("constructora", "certificados", first.id);
      await reverseOperation("constructora", "anticipos", advance.id);
      const [afterReversals] =
        await sql!`select coalesce(sum(debit_cents-credit_cents),0)::int as debt from current_account_entries where party_id=${client.id}`;
      expect(afterReversals.debt).toBe(0);
      expect(
        (await request(`constructora/items?workId=${w.id}`)).items.every(
          (item: { certified_cents: string }) =>
            Number(item.certified_cents) === 0,
        ),
      ).toBe(true);
      await request(`empresas/${company.id}/eliminar`, {
        confirmation: "Constructora QA",
      });
      await request("auth/empresa", { companyId });
    }, 30_000);
    it("protege CUIT sin eliminar duplicados históricos y permite recuperar su identidad", async () => {
      const { readFileSync } = await import("node:fs");
      const legacyId=randomUUID();
      const rollback=new Error("QA: revertir escenario histórico");
      try {
        await sql!.begin(async tx=>{
          await tx`drop trigger companies_cuit_guard on companies`;
          await tx`drop function company_cuit_guard()`;
          await tx`drop index if exists companies_cuit_unique`;
          await tx`drop table company_legacy_cuits`;
          const [source]=await tx`select to_jsonb(c) as data from companies c where id=${companyId}`;
          const historical={...source.data,id:legacyId,slug:`legacy-${legacyId}`};
          await tx`insert into companies select (jsonb_populate_record(null::companies,${JSON.stringify(historical)}::text::jsonb)).*`;
          await tx.unsafe(readFileSync("drizzle/0028_company_validation.sql","utf8"));
          const [count]=await tx`select count(*)::int as n from companies where cuit=${source.data.cuit}`;
          expect(count.n).toBe(2);
          const attempted={...historical,id:randomUUID(),slug:`new-${randomUUID()}`};
          await expect(tx.savepoint(async nested=>{
            await nested`insert into companies select (jsonb_populate_record(null::companies,${JSON.stringify(attempted)}::text::jsonb)).*`;
          })).rejects.toMatchObject({code:"23505"});
          await tx`update companies set cuit='99-12345678-0' where id=${legacyId}`;
          await expect(tx.savepoint(async nested=>{
            await nested`update companies set cuit=${source.data.cuit} where id=${legacyId}`;
          })).rejects.toMatchObject({code:"23505"});
          await tx`delete from companies where id=${legacyId}`;
          await tx`insert into companies select (jsonb_populate_record(null::companies,${JSON.stringify(historical)}::text::jsonb)).*`;
          throw rollback;
        });
      } catch(error) { if(error!==rollback) throw error; }
    });
    it("respaldos manuales y automáticos: recuperar sin reutilizar números ni reactivar colaboradores", async () => {
      const { buildCuit } = await import("../fiscal/cuit");
      const created = await request("empresas", {
        name: "Recuperación QA",
        legalName: "Recuperación QA",
        address: "Domicilio ficticio QA",
        activityStartedOn: "2026-01-01",
        cuit: buildCuit("30", "67123456"),
        taxCondition: "ri",
        businessSector: "comercio",
        pointsOfSale: [1],
        enabledModules: [
          "clientes",
          "proveedores",
          "articulos",
          "ventas",
          "compras",
          "caja",
          "stock",
          "cuentas_corrientes",
          "comprobantes",
          "auditoria",
        ],
      });
      const client = await request("clientes", {
        name: "Cliente respaldo QA",
        taxCondition: "cf",
      });
      const catalog = await request("catalogos");
      const type = catalog.documentTypes.find(
        (t: { code: string }) => t.code === "FAC",
      ).id;
      const sale = () =>
        request("documentos", {
          kind: "venta",
          documentTypeId: type,
          partyId: client.id,
          issuedOn: "2026-10-21",
          paymentMethod: "cuenta_corriente",
          lines: [
            {
              description: "Servicio QA",
              quantity: 1,
              unitPriceCents: 10000,
              ivaRateBps: 2100,
            },
          ],
        });
      const first = await sale();
      const [member] =
        await sql!`select id from users where email='mateo@talon.demo'`;
      const [role] =
        await sql!`select id from roles where company_id=${created.id} and key='vendedor'`;
      await sql!`insert into memberships(user_id,company_id,role_id) values(${member.id},${created.id},${role.id})`;
      const saved = await request("empresas/respaldos", {
        companyId: created.id,
      });
      const second = await sale();
      await request(
        `empresas/respaldos/${saved.backupId}/restaurar`,
        { confirmation: "Otro nombre" },
        400,
      );
      expect((await request(`documentos/${second.id}`)).status).toBe(
        "confirmado",
      );
      await request(`empresas/respaldos/${saved.backupId}/restaurar`, {
        confirmation: "Recuperación QA",
      });
      await request(`documentos/${second.id}`, undefined, 404);
      expect((await request(`documentos/${first.id}`)).status).toBe(
        "confirmado",
      );
      const third = await sale();
      expect(third.number).toBe(second.number + 1);
      const [inactive] =
        await sql!`select active from memberships where company_id=${created.id} and user_id=${member.id}`;
      expect(inactive.active).toBe(false);
      const [before] =
        await sql!`select id from company_lifecycle_events where target_id=${created.id} and action='antes_restaurar' order by created_at desc limit 1`;
      expect(before.id).toBeTruthy();
      const stale = await request("sync", {
        operations: [
          {
            key: randomUUID(),
            kind: "comprobante",
            createdAt: "2100-01-01T00:00:00Z",
            payload: {},
          },
        ],
      });
      expect(stale.results[0].status).toBe("conflict");
      const normalCookie = cookie;
      cookie = "";
      await request("auth/login", {
        email: "mateo@talon.demo",
        password: "talon1234",
      });
      const hidden = await fetch(
        `${base}/api/empresas/respaldos/${saved.backupId}`,
        { headers: { Cookie: cookie } },
      );
      expect(hidden.status).toBe(404);
      await request(
        `empresas/respaldos/${saved.backupId}/restaurar`,
        { confirmation: "Recuperación QA" },
        404,
      );
      cookie = normalCookie;
      const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import(
        "node:fs"
      );
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const directory = mkdtempSync(join(tmpdir(), "talon-backups-test-"));
      try {
        const env = {
          ...process.env,
          DATABASE_URL_ADMIN: urlFor("DATABASE_URL_ADMIN", database),
          DATABASE_URL: urlFor("DATABASE_URL", database),
          TALON_BACKUP_DIR: directory,
        };
        for (let i = 0; i < 2; i++)
          execFileSync(
            process.execPath,
            ["scripts/backup-worker.mjs", "--once"],
            { env, stdio: "pipe", timeout: 20000 },
          );
        const events =
          await sql!`select id from company_lifecycle_events where target_id=${created.id} and action='automatico'`;
        expect(events).toHaveLength(1);
        const files = readdirSync(join(directory, database));
        expect(files).toContain(`talon-${events[0].id}.json`);
        const downloaded = JSON.parse(
          readFileSync(
            join(directory, database, `talon-${events[0].id}.json`),
            "utf8",
          ),
        );
        expect(downloaded.company.id).toBe(created.id);
        expect(downloaded.documents).toHaveLength(2);
        expect(downloaded).not.toHaveProperty("users");
        // Vencer sólo automáticas: ni manuales ni evidencia de auditoría.
        await sql!`insert into company_lifecycle_events(target_id,target_name,actor_id,action,backup,created_at)
          select e.target_id,e.target_name,e.actor_id,'automatico',e.backup,now()-make_interval(days=>n)
          from company_lifecycle_events e cross join generate_series(1,20) n where e.id=${events[0].id}`;
        execFileSync(process.execPath, ["scripts/backup-worker.mjs", "--once"], { env, stdio: "pipe", timeout: 20000 });
        const retained=await sql!`select id,backup is not null as retained from company_lifecycle_events where target_id=${created.id} and action='automatico' order by created_at desc,id desc`;
        expect(retained).toHaveLength(21);
        expect(retained.filter(e=>e.retained)).toHaveLength(14);
        const remainingFiles=readdirSync(join(directory,database));
        for(const event of retained) expect(remainingFiles.includes(`talon-${event.id}.json`)).toBe(event.retained);
        const [manual]=await sql!`select backup is not null as retained from company_lifecycle_events where id=${saved.backupId}`;
        expect(manual.retained).toBe(true);

      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      await request(`empresas/${created.id}/eliminar`, {
        confirmation: "Recuperación QA",
      });
      await request("auth/empresa", { companyId });
    }, 30000);
    it("reintentos concurrentes del editor guardan una sola venta y no aceptan cambiar el contenido del envío", async () => {
      await request("auth/empresa", { companyId });
      const initial = await balances();
      const requestId = randomUUID();
      const send = (body: unknown, key: string = requestId) =>
        fetch(`${base}/api/documentos`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        });
      const responses = await Promise.all([
        send(draft("cuenta_corriente")),
        send(draft("cuenta_corriente")),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const results = await Promise.all(responses.map((r) => r.json()));
      expect(results[0].data.id).toBe(results[1].data.id);
      expect(await balances()).toEqual({
        ...initial,
        stock: initial.stock - 2,
        debt: initial.debt + 24200,
      });
      expect((await send(draft("cuenta_corriente", 3))).status).toBe(409);
      expect((await send(draft("cuenta_corriente"), "invalido")).status).toBe(
        400,
      );
      await request(`documentos/${results[0].data.id}/anular`, {
        reason: "Final QA de envío único",
      });
      expect((await send(draft("cuenta_corriente"))).status).toBe(409);
      expect(await balances()).toEqual(initial);
    });
    it("compras simultáneas del mismo proveedor y número no se duplican aunque se omita el punto de venta", async () => {
      await request("auth/empresa", { companyId });
      const supplier = await request("proveedores", {
        name: "Proveedor duplicados QA",
        taxCondition: "ri",
      });
      const catalog = await request("catalogos");
      const type = catalog.documentTypes.find(
        (t: { code: string }) => t.code === "FCP",
      ).id;
      const body = {
        kind: "compra",
        documentTypeId: type,
        partyId: supplier.id,
        issuedOn: "2026-10-21",
        paymentMethod: "cuenta_corriente",
        supplierNumber: 45678,
        lines: [
          {
            description: "Servicio de prueba",
            quantity: 1,
            unitPriceCents: 10000,
          },
        ],
      };
      const responses = await Promise.all(
        [0, 1].map(() =>
          fetch(`${base}/api/documentos`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const data = (await responses.find((r) => r.status === 200)!.json()).data;
      const duplicate = await responses.find((r) => r.status === 409)!.json();
      expect(duplicate.details.documentId).toBe(data.id);
      const [rows] =
        await sql!`select count(*)::int as n from documents where company_id=${companyId} and party_id=${supplier.id} and status='confirmado'`;
      expect(rows.n).toBe(1);
      await request(`documentos/${data.id}/anular`, {
        reason: "QA de duplicados",
      });
    });
  },
);
