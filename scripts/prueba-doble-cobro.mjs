#!/usr/bin/env node
/**
 * Prueba de concurrencia de cobros de Talón.
 *
 * Esta herramienta crea datos. Solo se habilita con:
 *   TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS
 *
 * Uso:
 *   TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS \
 *   TALON_EMAIL=laura@talon.demo TALON_PASSWORD=talon1234 \
 *   node scripts/prueba-doble-cobro.mjs http://127.0.0.1:4318 5 anticipo
 *
 * Variantes: anticipo, recibo, deuda-exacta o todas.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.argv[2] || "").replace(/\/$/, "");
const pairs = Math.max(1, Number.parseInt(process.argv[3] ?? "20", 10) || 20);
const requestedVariant = process.argv[4] ?? "anticipo";
const variants = requestedVariant === "todas"
  ? ["anticipo", "recibo", "deuda-exacta"]
  : [requestedVariant];
const validVariants = new Set(["anticipo", "recibo", "deuda-exacta"]);

if (!baseUrl || variants.some((variant) => !validVariants.has(variant))) {
  console.error(
    "Uso: node scripts/prueba-doble-cobro.mjs <baseUrl> [pares=20] [anticipo|recibo|deuda-exacta|todas]",
  );
  process.exit(2);
}
if (process.env.TALON_PRUEBA_CONFIRMAR !== "DATOS_FICTICIOS") {
  console.error(
    "Esta prueba crea clientes, comprobantes y cobros. Usá una base descartable y definí TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS.",
  );
  process.exit(2);
}

function todayInBuenosAires() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function request(path, { method = "GET", body, cookie, separateConnection = false } = {}) {
  const url = new URL(path, `${baseUrl}/`);
  const transport = url.protocol === "https:" ? https : http;
  const payload = body === undefined ? null : JSON.stringify(body);
  const agent = separateConnection
    ? new transport.Agent({ keepAlive: false, maxSockets: 1 })
    : undefined;
  return new Promise((resolveRequest, reject) => {
    const req = transport.request(url, {
      method,
      agent,
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {}),
      },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        agent?.destroy();
        const text = Buffer.concat(chunks).toString("utf8");
        resolveRequest({
          status: res.statusCode ?? 0,
          text,
          json: parseJson(text),
          setCookies: res.headers["set-cookie"] ?? [],
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("La solicitud tardó más de 30 segundos")));
    req.on("error", (error) => {
      agent?.destroy();
      reject(error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookies) {
  return setCookies.map((item) => item.split(";", 1)[0]).join("; ");
}

async function api(cookie, path, options = {}) {
  return request(`api/${path}`, { ...options, cookie });
}

async function login() {
  if (process.env.TALON_COOKIE?.trim()) return process.env.TALON_COOKIE.trim();
  const email = process.env.TALON_EMAIL?.trim();
  const password = process.env.TALON_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error("Definí TALON_EMAIL y TALON_PASSWORD, o TALON_COOKIE.");
  }
  const result = await api("", "auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (result.status !== 200 || !result.json?.ok) {
    throw new Error(`Login falló (${result.status}): ${result.text.slice(0, 300)}`);
  }
  const cookie = cookieFrom(result.setCookies);
  if (!cookie.includes("talon_session=")) throw new Error("El login no devolvió talon_session");
  return cookie;
}

async function readSession(cookie) {
  const result = await api(cookie, "auth/me");
  if (result.status !== 200 || !result.json?.data?.user?.id || !result.json?.data?.company?.id) {
    throw new Error(`No pude leer la sesión (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return {
    userId: result.json.data.user.id,
    companyId: result.json.data.company.id,
  };
}

async function createCustomer(cookie, label) {
  const result = await api(cookie, "clientes", {
    method: "POST",
    body: {
      name: label,
      docType: "DNI",
      cuit: String(10_000_000 + Math.floor(Math.random() * 80_000_000)),
      taxCondition: "cf",
      notes: "cliente ficticio de prueba-doble-cobro",
    },
  });
  if (result.status !== 200 || !result.json?.data?.id) {
    throw new Error(`Alta de cliente falló (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return result.json.data;
}

async function findInvoiceType(cookie) {
  const result = await api(cookie, "catalogos");
  const items = result.json?.data?.documentTypes ?? [];
  const type = Array.isArray(items)
    ? items.find((item) => item.code === "FAC" && item.active !== false)
    : null;
  if (result.status !== 200 || !type?.id) {
    throw new Error(`No encontré un comprobante FAC (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return type.id;
}

async function createExactDebt(cookie, partyId, amountCents) {
  const documentTypeId = await findInvoiceType(cookie);
  const result = await api(cookie, "documentos", {
    method: "POST",
    body: {
      kind: "venta",
      documentTypeId,
      partyId,
      issuedOn: todayInBuenosAires(),
      paymentMethod: "cuenta_corriente",
      lines: [{
        description: "Deuda ficticia para prueba de concurrencia",
        quantity: 1,
        unitPriceCents: amountCents,
        discountBps: 0,
        ivaRateBps: 0,
      }],
    },
  });
  if (result.status !== 200 || !result.json?.data?.id) {
    throw new Error(`Alta de deuda falló (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return result.json.data;
}

async function accountEntries(cookie, partyId) {
  const result = await api(
    cookie,
    `cuentas?partyType=customer&partyId=${encodeURIComponent(partyId)}`,
  );
  if (result.status !== 200 || !Array.isArray(result.json?.data?.entries)) {
    throw new Error(`Consulta de cuenta falló (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return result.json.data.entries;
}

async function countInDatabase(session, partyId, marker) {
  const databaseUrl = process.env.DATABASE_URL_ADMIN?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("El conteo SQL de esta prueba solo admite PostgreSQL en localhost");
  }
  const require = createRequire(import.meta.url);
  const postgres = require("postgres");
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql`
      select count(*)::int as count
      from current_account_entries
      where company_id = ${session.companyId}::uuid
        and party_type = 'customer'
        and party_id = ${partyId}::uuid
        and credit_cents > 0
        ${marker ? sql`and description = ${marker}` : sql``}
    `;
    return Number(row?.count ?? 0);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runPair(cookie, session, variant, index) {
  const tag = `${variant}-${Date.now()}-${index}-${randomUUID().slice(0, 8)}`;
  const customer = await createCustomer(cookie, `Race ${tag}`);
  const amountCents = 10_000 + index;
  if (variant === "deuda-exacta") await createExactDebt(cookie, customer.id, amountCents);

  const description = variant === "anticipo" ? `Prueba doble cobro ${tag}` : "Recibo";
  const body = {
    partyType: "customer",
    partyId: customer.id,
    amountCents,
    description,
    occurredOn: todayInBuenosAires(),
    anticipo: variant !== "deuda-exacta",
  };
  const [shotA, shotB] = await Promise.all([
    api(cookie, "cuentas/cobro", { method: "POST", body, separateConnection: true }),
    api(cookie, "cuentas/cobro", { method: "POST", body, separateConnection: true }),
  ]);
  const entries = await accountEntries(cookie, customer.id);
  // Cada par usa un cliente recién creado. En las variantes con REC, el
  // servidor reemplaza "Recibo" por la etiqueta numerada (por ejemplo REC A
  // 0001-00000001), por eso se cuentan todos sus créditos.
  const matchingEntries = entries.filter((entry) =>
    Number(entry.creditCents) > 0 &&
    (variant !== "anticipo" || entry.description === description));
  const databaseCount = await countInDatabase(
    session,
    customer.id,
    variant === "anticipo" ? description : null,
  );
  const successCount = [shotA, shotB].filter((shot) => shot.status >= 200 && shot.status < 300).length;
  const outcome = matchingEntries.length >= 2
    ? "duplicado"
    : matchingEntries.length === 1
      ? "unico"
      : "error";
  return {
    index,
    variant,
    tag,
    partyId: customer.id,
    amountCents,
    requests: [shotA, shotB].map((shot) => ({
      status: shot.status,
      ok: shot.json?.ok ?? null,
      id: shot.json?.data?.id ?? null,
      text: shot.text.slice(0, 2_000),
    })),
    apiCount: matchingEntries.length,
    databaseCount,
    successCount,
    outcome,
  };
}

async function main() {
  console.log(`Base: ${baseUrl}`);
  console.log(`Variantes: ${variants.join(", ")} · pares por variante: ${pairs}`);
  const cookie = await login();
  const session = await readSession(cookie);
  const details = [];

  for (const variant of variants) {
    for (let index = 1; index <= pairs; index += 1) {
      process.stdout.write(`  ${variant} ${index}/${pairs}... `);
      try {
        const row = await runPair(cookie, session, variant, index);
        details.push(row);
        console.log(`${row.outcome.toUpperCase()} (API=${row.apiCount}, DB=${row.databaseCount ?? "sin conteo"}, HTTP=${row.requests.map((item) => item.status).join(",")})`);
      } catch (error) {
        details.push({ variant, index, outcome: "error", error: String(error?.message ?? error) });
        console.log(`ERROR: ${String(error?.message ?? error).slice(0, 180)}`);
      }
    }
  }

  const summary = {
    pairs: details.length,
    unique: details.filter((row) => row.outcome === "unico").length,
    duplicates: details.filter((row) => row.outcome === "duplicado").length,
    errors: details.filter((row) => row.outcome === "error").length,
    byVariant: Object.fromEntries(variants.map((variant) => {
      const rows = details.filter((row) => row.variant === variant);
      return [variant, {
        pairs: rows.length,
        unique: rows.filter((row) => row.outcome === "unico").length,
        duplicates: rows.filter((row) => row.outcome === "duplicado").length,
        errors: rows.filter((row) => row.outcome === "error").length,
      }];
    })),
  };
  console.log(JSON.stringify(summary));

  const configuredLogDir = process.env.TALON_PRUEBA_LOG_DIR?.trim();
  const logDir = configuredLogDir
    ? (isAbsolute(configuredLogDir) ? configuredLogDir : resolve(process.cwd(), configuredLogDir))
    : resolve(scriptDir, "../logs");
  await mkdir(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(logDir, `prueba-doble-cobro-${timestamp}.json`);
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    summary,
    strategy: {
      safety: "requiere TALON_PRUEBA_CONFIRMAR=DATOS_FICTICIOS",
      transport: "dos conexiones HTTP independientes por par",
      variants: {
        anticipo: "descripción única, sin comprobante",
        recibo: "anticipo con generación real de REC",
        "deuda-exacta": "factura previa y dos intentos simultáneos por el saldo exacto",
      },
    },
    details,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Detalle: ${outputPath}`);
  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
