import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { verifyPassword } from "@/lib/auth/password";
import { MODULES, allPermissions, can, moduleEnabled, type ModuleKey } from "@/lib/auth/permissions";
import { authFromToken, clearSession, getAuth, publicUser, requirePermission, startSession, switchCompany } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { getDb } from "@/lib/db/client";
import {
  auditLog,
  cashAccounts,
  cashMovements,
  categories,
  companies,
  currentAccountEntries,
  customFieldDefs,
  customers,
  documentTypes,
  ledgerAccounts,
  memberships,
  priceLists,
  productPrices,
  products,
  roles,
  rolePermissions,
  stockLevels,
  stockMovements,
  suppliers,
  users,
  warehouses,
  customFieldValues,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/domain/audit";
import { createDocument, getDocument, listDocuments, voidDocument, type DocumentKind } from "@/lib/domain/documents";
import { IVA_RATES, TAX_CONDITION_LABELS } from "@/lib/fiscal/labels";
import { CATALOG_CACHE, HttpError, likeTerm, ok, pageParams } from "@/lib/http";
import { cashOutAllowed, collectionAllowed, moneyError } from "@/lib/guards";
import { companySchema, documentSchema, normalizeTaxId, partySchema, productSchema, readBody } from "@/lib/validation";
import { saveCustomFields } from "./custom-fields";
import { exchange } from "./exchange";
import { showsAccountCard } from "@/lib/auth/access";
import { cashDirectionForParty, derivedStockFactor } from "@/lib/stock-rules";
import { cajaDifferenceText, formatMoney, todayIso } from "@/lib/format";
import { invoiceBlocked } from "@/lib/stock-rules";
import { estacion } from "./estacion";
import { reparto } from "./reparto";
import { sync } from "./sync";
import { informes } from "./informes";
import { constructora } from "./constructora";
import { inmobiliaria } from "./inmobiliaria";
import { reversals } from "./reversals";
import { companyManagement } from "./company-management";
import { migracion } from "./migracion";

const KIND_MODULE: Record<DocumentKind, ModuleKey> = {
  venta: "ventas",
  compra: "compras",
  pedido: "pedidos",
  remito: "remitos",
};

function isKind(value: string): value is DocumentKind {
  return value === "venta" || value === "compra" || value === "pedido" || value === "remito";
}

export async function dispatch(method: string, path: string[], req: Request): Promise<Response> {
  const url = new URL(req.url);
  const [root, id, action] = path;

  if (method === "GET" && root === "health") return ok({ ok: true });

  if (method === "GET" && root === "salud") {
    const rows = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    return ok({ db: rows[0]?.ok === 1 });
  }

  if (root === "reversiones") return reversals(method, path, req);
  if (root === "constructora") return constructora(method, path, req);
  if (root === "inmobiliaria") return inmobiliaria(method, path, req);
  if (root === "empresas") return companyManagement(method, path, req);
  if (root === "auth") return authRoutes(method, id, req);
  if (method === "GET" && root === "tablero") return tablero();
  if (method === "GET" && root === "catalogos") return catalogos();
  if (root === "clientes") return parties(method, "customer", id, req, url);
  if (root === "proveedores") return parties(method, "supplier", id, req, url);
  if (root === "articulos") return articles(method, id, req, url);
  if (root === "documentos") return docs(method, id, action, req, url);
  if (root === "stock") return stock(method, id, req, url);
  if (root === "caja") return caja(method, id, req, url);
  if (root === "cuentas") return cuentas(method, id, req, url);
  if (root === "contabilidad") return contabilidad(method, id, req);
  if (root === "listas") return listas(method, id, action, req);
  if (root === "auditoria") return auditoria(method, url);
  if (root === "configuracion") return configuracion(method, req);
  if (root === "campos") return campos(method, id, req);
  if (root === "rubros") return rubros(method, id, req);
  if (root === "usuarios") return usuarios(method, req);
  if (root === "roles") return rolesRoute(method, id, req);
  if (root === "comprobantes") return comprobante(method, id, req);
  if (root === "reparto") return reparto(method, path, req);
  if (root === "sync") return sync(method, path, req);
  if (root === "informes") return informes(method, url);
  if (root === "migracion") return migracion(method, path, req);
  if (root === "importar" || root === "exportar") return exchange(method, path, req);
  if (root === "estacion") return estacion(method, path, req);

  throw new HttpError(404, "No existe esa ruta");
}

async function authRoutes(method: string, action: string | undefined, req: Request) {
  if (method === "POST" && action === "login") {
    const body = await readBody(req, zLogin);
    const rows = await getDb().execute<{ id: string; name: string; email: string; password_hash: string; active: boolean }>(
      sql`select * from auth_find_user(${body.email})`,
    );
    const user = rows[0];
    const dummy = "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
    const valid = verifyPassword(body.password, user?.password_hash ?? dummy);
    if (!user || !user.active || !valid) throw new HttpError(401, "El mail o la clave no coinciden");
    const home = await getDb().execute<{ company_id: string | null }>(sql`select auth_home_company(${user.id}::uuid) as company_id`);
    const companyId = home[0]?.company_id;
    if (!companyId) {
      const [backup] = await getDb().execute<{ available: boolean }>(sql`select company_user_has_backups(${user.id}::uuid) as available`);
      const [operator] = await getDb().execute<{ available: boolean }>(sql`select company_user_is_operator(${user.id}::uuid) as available`);
      if (!backup.available && !operator.available) throw new HttpError(403, "Tu usuario no está en ninguna empresa activa");
      await startSession(user.id, "00000000-0000-0000-0000-000000000000");
      return ok(operator.available ? { companySetupOnly: true } : { backupOnly: true });
    }
    const token = await startSession(user.id, companyId);
    const auth = await authFromToken(token, companyId);
    if (!auth) throw new HttpError(500, "No pude abrir la sesión");
    return ok(publicUser(auth));
  }
  if (method === "POST" && action === "logout") {
    await clearSession();
    return ok({ bye: true });
  }
  if (method === "GET" && action === "me") {
    const auth = await getAuth();
    if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
    return ok(publicUser(auth));
  }
  if (method === "POST" && action === "empresa") {
    const auth = await getAuth();
    if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
    const body = await readBody(req, zCompanySwitch);
    if (!auth.memberships.some((item) => item.companyId === body.companyId)) {
      throw new HttpError(403, "No pertenecés a esa empresa");
    }
    await getDb().execute(sql`select auth_remember_company(${auth.user.id}::uuid, ${body.companyId}::uuid)`);
    await switchCompany(body.companyId);
    const token = (await cookies()).get("talon_session")?.value;
    const next = token ? await authFromToken(token, body.companyId) : null;
    if (!next) throw new HttpError(401, "Tenés que iniciar sesión");
    return ok(publicUser(next));
  }
  throw new HttpError(404, "No existe esa ruta");
}

const zLogin = z.object({
  email: z.string().trim().email("Ingresá un mail válido"),
  password: z.string().min(1, "Falta la clave"),
});
const zCompanySwitch = z.object({ companyId: z.string().uuid() });

async function tablero() {
  const auth = await requirePermission("dashboard", "ver");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const rows = await tx.execute<{
      ventas_mes: string;
      compras_mes: string;
      caja: string;
      deudores: string;
      acreedores: string;
    }>(sql`
      select
        (select coalesce(sum(d.total_cents * dt.sign), 0)::text
           from documents d
           join document_types dt on dt.id = d.document_type_id
          where d.company_id = ${auth.company.companyId}
            and d.kind = 'venta' and d.status = 'confirmado'
            and d.issued_on >= date_trunc('month', current_date)::date) as ventas_mes,
        (select coalesce(sum(d.total_cents * dt.sign), 0)::text
           from documents d
           join document_types dt on dt.id = d.document_type_id
          where d.company_id = ${auth.company.companyId}
            and d.kind = 'compra' and d.status = 'confirmado'
            and d.issued_on >= date_trunc('month', current_date)::date) as compras_mes,
        (select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::text
           from cash_movements where company_id = ${auth.company.companyId}) as caja,
        (select coalesce(sum(debit_cents - credit_cents), 0)::text
           from current_account_entries
          where company_id = ${auth.company.companyId} and party_type = 'customer') as deudores,
        (select coalesce(sum(credit_cents - debit_cents), 0)::text
           from current_account_entries
          where company_id = ${auth.company.companyId} and party_type = 'supplier') as acreedores
    `);
    const kinds = [
      can(auth.permissions, "ventas", "ver") ? "venta" : null,
      can(auth.permissions, "compras", "ver") ? "compra" : null,
      can(auth.permissions, "pedidos", "ver") ? "pedido" : null,
      can(auth.permissions, "remitos", "ver") ? "remito" : null,
    ].filter((kind): kind is string => Boolean(kind));
    const recent = kinds.length
      ? await tx.execute<{
          id: string;
          kind: string;
          letter: string | null;
          point_of_sale: number;
          number: number;
          party_name: string;
          total_cents: string;
          issued_on: string;
          status: string;
          sign: number;
          code: string;
        }>(sql`
          select d.id, d.kind, d.letter, d.point_of_sale, d.number, d.party_name,
                 d.total_cents::text, d.issued_on::text, d.status, dt.sign, dt.code
            from documents d
            join document_types dt on dt.id = d.document_type_id
           where d.company_id = ${auth.company.companyId}
             and d.kind in (${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})
           order by d.issued_on desc, d.created_at desc
           limit 8
        `)
      : [];
    const low = can(auth.permissions, "stock", "ver")
      ? await tx.execute<{ id: string; sku: string; name: string; quantity: string; min_stock: string }>(sql`
          select p.id, p.sku, p.name, coalesce(sum(s.quantity), 0)::text as quantity, p.min_stock::text
            from products p
            left join stock_levels s on s.product_id = p.id
           where p.company_id = ${auth.company.companyId} and p.tracks_stock and p.active
           group by p.id
          having p.min_stock > 0 and coalesce(sum(s.quantity), 0) < p.min_stock
           order by coalesce(sum(s.quantity), 0)
           limit 6
        `)
      : [];
    const head = rows[0];
    const see = (moduleKey: string) => can(auth.permissions, moduleKey, "ver");
    return ok({
      ventasMesCents: see("ventas") ? Number(head?.ventas_mes ?? 0) : null,
      comprasMesCents: see("compras") ? Number(head?.compras_mes ?? 0) : null,
      cajaCents: see("caja") ? Number(head?.caja ?? 0) : null,
      deudoresCents: showsAccountCard(auth.permissions, "clientes") ? Number(head?.deudores ?? 0) : null,
      acreedoresCents: showsAccountCard(auth.permissions, "proveedores") ? Number(head?.acreedores ?? 0) : null,
      recent: recent.map((row) => ({
        id: row.id,
        kind: row.kind,
        code: row.code,
        letter: row.letter,
        pointOfSale: row.point_of_sale,
        number: row.number,
        partyName: row.party_name,
        totalCents: Number(row.total_cents),
        issuedOn: row.issued_on,
        status: row.status,
        sign: row.sign,
      })),
      lowStock: low.map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        quantity: Number(row.quantity),
        minStock: Number(row.min_stock),
      })),
    });
  });
}

async function catalogos() {
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const companyId = auth.company.companyId;
    const [lists, deps, types, cash, rubros, fields, points] = await Promise.all([
      tx.select().from(priceLists).where(eq(priceLists.companyId, companyId)).orderBy(asc(priceLists.name)),
      tx.select().from(warehouses).where(eq(warehouses.companyId, companyId)).orderBy(asc(warehouses.name)),
      tx.select().from(documentTypes).where(and(eq(documentTypes.companyId, companyId), eq(documentTypes.active, true))).orderBy(asc(documentTypes.code)),
      tx.select().from(cashAccounts).where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.active, true))).orderBy(asc(cashAccounts.name)),
      tx.select().from(categories).where(eq(categories.companyId, companyId)).orderBy(asc(categories.name)),
      tx.select().from(customFieldDefs).where(eq(customFieldDefs.companyId, companyId)).orderBy(asc(customFieldDefs.position)),
      tx.execute<{ number: number }>(sql`select number from company_points_of_sale where company_id=${companyId} order by number`),
    ]);
    return ok(
      {
        pointsOfSale: points.map((point) => point.number),
        priceLists: lists,
        warehouses: deps,
        documentTypes: types,
        cashAccounts: cash,
        categories: rubros,
        customFields: fields,
        ivaRates: IVA_RATES,
        taxConditions: TAX_CONDITION_LABELS,
      },
      CATALOG_CACHE,
    );
  });
}

async function parties(method: string, kind: "customer" | "supplier", id: string | undefined, req: Request, url: URL) {
  const moduleKey = kind === "customer" ? "clientes" : "proveedores";
  if (method === "GET" && !id) {
    const auth = await requirePermission(moduleKey, "ver");
    const page = pageParams(url);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const table = kind === "customer" ? customers : suppliers;
      const term = page.q ? likeTerm(page.q) : "";
      const where = and(
        eq(table.companyId, auth.company.companyId),
        url.searchParams.get("active")==="1" ? eq(table.active,true) : undefined,
        term
          ? or(ilike(table.name, term), ilike(table.cuit, term), ilike(table.fantasyName, term), ilike(table.code, term))
          : undefined,
      );
      const [items, countRows] = await Promise.all([
        tx.select().from(table).where(where).orderBy(asc(table.name)).limit(page.pageSize).offset(page.offset),
        tx.select({ total: sql<number>`count(*)::int` }).from(table).where(where),
      ]);
      return ok({ items, total: Number(countRows[0]?.total ?? 0), page: page.page, pageSize: page.pageSize });
    });
  }
  if (method === "GET" && id) {
    const auth = await requirePermission(moduleKey, "ver");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const table = kind === "customer" ? customers : suppliers;
      const [row] = await tx.select().from(table).where(and(eq(table.id, id), eq(table.companyId, auth.company.companyId)));
      if (!row) throw new HttpError(404, "No encontramos la ficha");
      const fields = await tx
        .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
        .from(customFieldValues)
        .where(eq(customFieldValues.recordId, row.id));
      return ok({ ...row, customFields: fields });
    });
  }
  if (method === "POST" && !id) {
    const auth = await requirePermission(moduleKey, "crear");
    const body = await readBody(req, partySchema);
    const cuit = normalizeTaxId(body.docType, body.cuit);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const code = await nextCode(tx, kind === "customer" ? "customers" : "suppliers", auth.company.companyId, kind === "customer" ? "C" : "P");
      const values = {
        companyId: auth.company.companyId,
        code,
        name: body.name,
        fantasyName: body.fantasyName || null,
        docType: body.docType,
        cuit,
        taxCondition: body.taxCondition,
        address: body.address || null,
        city: body.city || null,
        province: body.province || null,
        phone: body.phone || null,
        email: body.email || null,
        paymentTermsDays: body.paymentTermsDays,
        notes: body.notes || null,
        active: body.active,
      };
      const [row] =
        kind === "customer"
          ? await tx
              .insert(customers)
              .values({
                ...values,
                iibb: body.iibb || null,
                iibbPerceptionBps: body.iibbPerceptionBps ?? null,
                postalCode: body.postalCode || null,
                contact: body.contact || null,
                priceListId: body.priceListId ?? null,
                discountBps: body.discountBps,
                creditLimitCents: body.creditLimitCents,
                zone: body.zone || null,
              })
              .returning()
          : await tx.insert(suppliers).values(values).returning();
      await saveCustomFields(tx, auth.company.companyId, row.id, body.customFields);
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: `${moduleKey}.crear`,
        entity: moduleKey,
        entityId: row.id,
        summary: `Alta de ${body.name}`,
      });
      return ok(row);
    });
  }
  if (method === "PATCH" && id) {
    const auth = await requirePermission(moduleKey, "editar");
    const body = await readBody(req, partySchema);
    const cuit = normalizeTaxId(body.docType, body.cuit);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const source=kind==="customer"?customers:suppliers;
      const [before]=await tx.select().from(source).where(and(eq(source.id,id),eq(source.companyId,auth.company.companyId))).for("update");
      if(!before)throw new HttpError(404,"No encontramos la ficha");
      const patch = {
        name: body.name,
        fantasyName: body.fantasyName || null,
        docType: body.docType,
        cuit,
        taxCondition: body.taxCondition,
        address: body.address || null,
        city: body.city || null,
        province: body.province || null,
        phone: body.phone || null,
        email: body.email || null,
        paymentTermsDays: body.paymentTermsDays,
        notes: body.notes || null,
        active: body.active,
      };
      const [row] =
        kind === "customer"
          ? await tx
              .update(customers)
              .set({
                ...patch,
                iibb: body.iibb || null,
                iibbPerceptionBps: body.iibbPerceptionBps ?? null,
                postalCode: body.postalCode || null,
                contact: body.contact || null,
                priceListId: body.priceListId ?? null,
                discountBps: body.discountBps,
                creditLimitCents: body.creditLimitCents,
                zone: body.zone || null,
              })
              .where(and(eq(customers.id, id), eq(customers.companyId, auth.company.companyId)))
              .returning()
          : await tx
              .update(suppliers)
              .set(patch)
              .where(and(eq(suppliers.id, id), eq(suppliers.companyId, auth.company.companyId)))
              .returning();
      if (!row) throw new HttpError(404, "No encontramos la ficha");
      await saveCustomFields(tx, auth.company.companyId, row.id, body.customFields);
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: `${moduleKey}.editar`,
        entity: moduleKey,
        entityId: row.id,
        summary: `Editó la ficha de ${body.name}`,
        metadata:{changes:Object.entries(row).filter(([field,value])=>field!=="updatedAt"&&JSON.stringify(value)!==JSON.stringify((before as Record<string,unknown>)[field])).map(([field,value])=>({field,before:(before as Record<string,unknown>)[field]??null,after:value}))},
      });
      return ok(row);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function nextCode(tx: Parameters<Parameters<typeof withTenant>[2]>[0], table: "customers" | "suppliers" | "products", companyId: string, prefix: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${table}`},260030))`);
  const source = table === "customers" ? customers : table === "suppliers" ? suppliers : products;
  const rows = await tx.select({ total: sql<number>`count(*)::int` }).from(source).where(eq(source.companyId, companyId));
  return `${prefix}${String(Number(rows[0]?.total ?? 0) + 1).padStart(4, "0")}`;
}

async function articles(method: string, id: string | undefined, req: Request, url: URL) {
  if (method === "GET" && !id) {
    const auth = await requirePermission("articulos", "ver");
    const page = pageParams(url, 80);
    const listId = url.searchParams.get("priceListId");
    const exact = url.searchParams.get("exact") === "1";
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const term = page.q ? likeTerm(page.q) : "";
      const where = and(
        eq(products.companyId, auth.company.companyId),
        exact && page.q ? eq(products.sku, page.q.trim()) : undefined,
        !exact && term ? or(ilike(products.name, term), ilike(products.sku, term), ilike(products.barcode, term)) : undefined,
      );
      const [items, countRows] = await Promise.all([
        tx.select({ product: products, listPriceCents: productPrices.priceCents })
          .from(products)
          .leftJoin(productPrices, and(
            eq(productPrices.productId, products.id),
            eq(productPrices.companyId, auth.company.companyId),
            listId ? eq(productPrices.priceListId, listId) : sql`false`,
          ))
          .where(where).orderBy(asc(products.name)).limit(page.pageSize).offset(page.offset),
        tx.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
      ]);
      return ok({
        items: items.map(({ product, listPriceCents }) => ({ ...product, listPriceCents })),
        total: Number(countRows[0]?.total ?? 0),
        page: page.page,
        pageSize: page.pageSize,
      });
    });
  }
  if (method === "GET" && id) {
    const auth = await requirePermission("articulos", "ver");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.companyId, auth.company.companyId)));
      if (!row) throw new HttpError(404, "No encontramos el artículo");
      const [prices, fields, stock] = await Promise.all([
        tx.select().from(productPrices).where(eq(productPrices.productId, id)),
        tx.select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value }).from(customFieldValues).where(eq(customFieldValues.recordId, id)),
        tx.select().from(stockLevels).where(eq(stockLevels.productId, id)),
      ]);
      return ok({ ...row, prices, customFields: fields, stock });
    });
  }
  if (method === "POST") {
    const auth = await requirePermission("articulos", "crear");
    const body = await readBody(req, productSchema);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          companyId: auth.company.companyId,
          sku: body.sku,
          barcode: body.barcode || null,
          name: body.name,
          categoryId: body.categoryId ?? null,
          unit: body.unit,
          ivaRateBps: body.ivaRateBps,
          taxTreatment: body.taxTreatment,
          tracksStock: body.tracksStock,
          costCents: body.costCents,
          minStock: body.minStock,
          supplierId: body.supplierId ?? null,
          notes: body.notes || null,
          active: body.active,
        })
        .returning();
      const prices = body.prices ?? [];
      if (prices.length) {
        await tx.insert(productPrices).values(
          prices.map((price) => ({
            productId: row.id,
            priceListId: price.priceListId,
            companyId: auth.company.companyId,
            priceCents: price.priceCents,
          })),
        );
      }
      await saveCustomFields(tx, auth.company.companyId, row.id, body.customFields);
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "articulos.crear",
        entity: "articulos",
        entityId: row.id,
        summary: `Alta de ${body.sku} ${body.name}`,
      });
      return ok(row);
    });
  }
  if (method === "PATCH" && id) {
    const auth = await requirePermission("articulos", "editar");
    const body = await readBody(req, productSchema);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .update(products)
        .set({
          sku: body.sku,
          barcode: body.barcode || null,
          name: body.name,
          categoryId: body.categoryId ?? null,
          unit: body.unit,
          ivaRateBps: body.ivaRateBps,
          taxTreatment: body.taxTreatment,
          tracksStock: body.tracksStock,
          costCents: body.costCents,
          minStock: body.minStock,
          supplierId: body.supplierId ?? null,
          notes: body.notes || null,
          active: body.active,
        })
        .where(and(eq(products.id, id), eq(products.companyId, auth.company.companyId)))
        .returning();
      if (!row) throw new HttpError(404, "No encontramos el artículo");
      await tx.delete(productPrices).where(eq(productPrices.productId, id));
      const prices = body.prices ?? [];
      if (prices.length) {
        await tx.insert(productPrices).values(
          prices.map((price) => ({
            productId: id,
            priceListId: price.priceListId,
            companyId: auth.company.companyId,
            priceCents: price.priceCents,
          })),
        );
      }
      await saveCustomFields(tx, auth.company.companyId, id, body.customFields);
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "articulos.editar",
        entity: "articulos",
        entityId: id,
        summary: `Editó ${body.sku} ${body.name}`,
      });
      return ok(row);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function docs(method: string, id: string | undefined, action: string | undefined, req: Request, url: URL) {
  if (method === "GET" && !id) {
    const kind = url.searchParams.get("kind") ?? "";
    if (!isKind(kind)) throw new HttpError(400, "Falta el tipo de operación");
    const auth = await requirePermission(KIND_MODULE[kind], "ver");
    const page = pageParams(url);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const data = await listDocuments(tx, auth.company.companyId, {
        kind,
        q: page.q,
        status: url.searchParams.get("status") ?? "",
        pageSize: page.pageSize,
        offset: page.offset,
      });
      return ok({ ...data, page: page.page, pageSize: page.pageSize });
    });
  }
  if (method === "POST" && !id) {
    const body = await readBody(req, documentSchema);
    const auth = await requirePermission(KIND_MODULE[body.kind], "crear");
    if (body.allowNegativeStock && !can(auth.permissions, "stock", "editar")) {
      throw new HttpError(403, "Tu puesto no puede dejar el stock en negativo.");
    }
    const requestId=req.headers.get("Idempotency-Key");
    if(requestId && !z.string().uuid().safeParse(requestId).success)throw new HttpError(400,"El identificador del envío no es válido");
    const fingerprint=createHash("sha256").update(JSON.stringify(body)).digest("hex");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const key=requestId ? `editor:${requestId}` : null;
      if(key){
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${auth.company.companyId}:${key}`},260029))`);
        const [existing]=await tx.execute<{user_id:string;kind:string;result:{fingerprint:string;document:{id:string}}}>(sql`select user_id,kind,result from idempotency_keys where company_id=${auth.company.companyId} and key=${key}`);
        if(existing){
          if(existing.user_id!==auth.user.id || existing.kind!=="editor.documento" || existing.result.fingerprint!==fingerprint)throw new HttpError(409,"Este envío ya se utilizó con otros datos. Revisá el comprobante antes de continuar.");
          const document=await getDocument(tx,auth.company.companyId,existing.result.document.id);
          if(!document || document.status!=="confirmado")throw new HttpError(409,"Este envío ya fue registrado y luego anulado o recuperado. Iniciá un nuevo comprobante.");
          return ok(existing.result.document);
        }
      }
      const data=await createDocument(tx,{userId:auth.user.id,companyId:auth.company.companyId},{...body,allowNegativeStock:Boolean(body.allowNegativeStock)&&can(auth.permissions,"stock","editar")});
      if(key)await tx.execute(sql`insert into idempotency_keys(company_id,key,user_id,kind,status,result) values(${auth.company.companyId},${key},${auth.user.id},'editor.documento','applied',${JSON.stringify({fingerprint,document:data})}::jsonb)`);
      return ok(data);
    });
  }
  if (method === "GET" && id && !action) {
    const auth = await getAuth();
    if (!auth) throw new HttpError(401, "Tenés que iniciar sesión");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const document = await getDocument(tx, auth.company.companyId, id);
      if (!document) throw new HttpError(404, "No encontramos el comprobante");
      if (!isKind(document.kind) || !can(auth.permissions, KIND_MODULE[document.kind], "ver")) {
        throw new HttpError(403, "No tenés permiso para ver ese comprobante");
      }
      return ok(document);
    });
  }
  if (method === "POST" && id && action === "derivar") return derivar(req, id);
  if (method === "POST" && id && action === "anular") {
    const authPeek = await getAuth();
    if (!authPeek) throw new HttpError(401, "Tenés que iniciar sesión");
    const body = await readBody(req, z.object({ reason: z.string().trim().max(240).optional().default("") }));
    return withTenant(authPeek.company.companyId, authPeek.user.id, async (tx) => {
      const existing = await getDocument(tx, authPeek.company.companyId, id);
      if (!existing || !isKind(existing.kind)) throw new HttpError(404, "No encontramos el comprobante");
      if (!moduleEnabled(authPeek.company.enabledModules, KIND_MODULE[existing.kind]) || !can(authPeek.permissions, KIND_MODULE[existing.kind], "anular")) {
        throw new HttpError(403, "No podés anular este comprobante");
      }
      const result = await voidDocument(tx, { userId: authPeek.user.id, companyId: authPeek.company.companyId }, id, body.reason ?? "");
      return ok(result);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function stock(method: string, action: string | undefined, req: Request, url: URL) {
  if (method === "GET") {
    const auth = await requirePermission("stock", "ver");
    const page = pageParams(url, 80);
    const warehouseId = url.searchParams.get("warehouseId");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const term = page.q ? likeTerm(page.q) : "";
      const rows = await tx.execute<{
        id: string;
        sku: string;
        name: string;
        unit: string;
        min_stock: string;
        warehouse_id: string;
        warehouse_name: string;
        quantity: string;
        total: string;
      }>(sql`
        select p.id, p.sku, p.name, p.unit, p.min_stock::text,
               w.id as warehouse_id, w.name as warehouse_name,
               coalesce(s.quantity, 0)::text as quantity,
               count(*) over()::text as total
          from products p
          join warehouses w on w.company_id = p.company_id
          left join stock_levels s on s.product_id = p.id and s.warehouse_id = w.id
         where p.company_id = ${auth.company.companyId}
           and p.tracks_stock
           and (${warehouseId ?? null}::uuid is null or w.id = ${warehouseId ?? null}::uuid)
           and (${term} = '' or p.name ilike ${term} or p.sku ilike ${term})
         order by p.name, w.name
         limit ${page.pageSize} offset ${page.offset}
      `);
      return ok({
        items: rows.map((row) => ({
          id: row.id,
          sku: row.sku,
          name: row.name,
          unit: row.unit,
          minStock: Number(row.min_stock),
          warehouseId: row.warehouse_id,
          warehouseName: row.warehouse_name,
          quantity: Number(row.quantity),
        })),
        total: Number(rows[0]?.total ?? 0),
        page: page.page,
        pageSize: page.pageSize,
      });
    });
  }
  if (method === "POST" && action === "ajustes") {
    const auth = await requirePermission("stock", "crear");
    const body = await readBody(req, zStock);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const delta = body.direction === "out" ? -body.quantity : body.quantity;
      if (body.direction === "out" && auth.company.blockNegativeStock) {
        const current = await tx.execute<{ quantity: string }>(sql`
          select coalesce(quantity, 0)::text as quantity from stock_levels
          where product_id = ${body.productId} and warehouse_id = ${body.warehouseId}
        `);
        if (Number(current[0]?.quantity ?? 0) - body.quantity < -0.0001) {
          throw new HttpError(409, "No hay stock suficiente. La empresa no deja existir en negativo.");
        }
      }
      await tx.execute(sql`
        insert into stock_levels (product_id, warehouse_id, company_id, quantity)
        values (${body.productId}, ${body.warehouseId}, ${auth.company.companyId}, ${delta.toFixed(3)})
        on conflict (product_id, warehouse_id)
        do update set quantity = stock_levels.quantity + excluded.quantity
      `);
      await tx.insert(stockMovements).values({
        companyId: auth.company.companyId,
        productId: body.productId,
        warehouseId: body.warehouseId,
        quantity: delta,
        reason: body.note?.trim() || "Ajuste manual",
        createdBy: auth.user.id,
      });
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "stock.ajuste",
        entity: "stock",
        entityId: body.productId,
        summary: `Ajustó stock (${body.direction === "out" ? "salida" : "entrada"} ${body.quantity})`,
      });
      return ok({ ok: true });
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

const zStock = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().positive(),
  direction: z.enum(["in", "out"]),
  note: z.string().max(200).optional(),
});

async function caja(method: string, action: string | undefined, req: Request, url: URL) {
  if (method === "GET") {
    const auth = await requirePermission("caja", "ver");
    const page = pageParams(url);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [accounts, movements, totals] = await Promise.all([
        tx.select().from(cashAccounts).where(eq(cashAccounts.companyId, auth.company.companyId)).orderBy(asc(cashAccounts.name)),
        tx
          .select()
          .from(cashMovements)
          .where(eq(cashMovements.companyId, auth.company.companyId))
          .orderBy(desc(cashMovements.occurredOn), desc(cashMovements.createdAt))
          .limit(page.pageSize)
          .offset(page.offset),
        tx.execute<{ id: string; balance: string; session_balance: string }>(sql`
          with openings as (
            select cash_account_id, max(created_at) as opened_at
            from cash_movements
            where company_id = ${auth.company.companyId} and description = 'Saldo de apertura'
            group by cash_account_id
          )
          select a.id::text,
            coalesce(sum(case when m.direction = 'in' then m.amount_cents else -m.amount_cents end), 0)::text as balance,
            coalesce(sum(case when m.direction = 'in' then m.amount_cents else -m.amount_cents end)
              filter (where m.created_at >= coalesce(o.opened_at, '-infinity'::timestamptz)), 0)::text as session_balance
          from cash_accounts a
          left join cash_movements m on m.cash_account_id = a.id
          left join openings o on o.cash_account_id = a.id
          where a.company_id = ${auth.company.companyId}
          group by a.id, o.opened_at
        `),
      ]);
      return ok({
        accounts,
        balances: Object.fromEntries(totals.map((row) => [row.id, Number(row.balance)])),
        sessionBalances: Object.fromEntries(totals.map((row) => [row.id, Number(row.session_balance)])),
        movements,
        page: page.page,
        pageSize: page.pageSize,
      });
    });
  }
  if (method === "POST" && !action) {
    const auth = await requirePermission("caja", "crear");
    const body = await readBody(req, z.object({ name: z.string().trim().min(1).max(80) }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.insert(cashAccounts).values({ companyId: auth.company.companyId, name: body.name, kind: "caja", active: true }).returning();
      await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "caja.abrir", entity: "caja", entityId: row.id, summary: `Abrió la caja ${body.name}` });
      return ok(row);
    });
  }
  if (method === "POST" && (action === "abrir" || action === "cerrar")) {
    const auth = await requirePermission("caja", "editar");
    const body = await readBody(req, z.object({ cashAccountId: z.string().uuid(), countedCents: z.number().int().nonnegative().optional(), openingCents: z.number().int().nonnegative().optional() }));
    const open = action === "abrir";
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.update(cashAccounts).set({ active: open }).where(and(eq(cashAccounts.id, body.cashAccountId), eq(cashAccounts.companyId, auth.company.companyId))).returning();
      if (!row) throw new HttpError(404, "No encontramos la caja");
      const balance = await tx.execute<{ balance: string }>(sql`
        select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::text as balance
        from cash_movements
        where cash_account_id = ${row.id}
          and created_at >= coalesce(
            (select max(created_at) from cash_movements where cash_account_id = ${row.id} and description = 'Saldo de apertura'),
            '-infinity'::timestamptz
          )
      `);
      if (!open && body.countedCents == null) throw new HttpError(400, "Para cerrar hay que anotar el arqueo: esperado contra contado");
      const system = Number(balance[0]?.balance ?? 0);
      if (open && body.openingCents != null && body.openingCents >= 0) {
        await tx.insert(cashMovements).values({ companyId: auth.company.companyId, cashAccountId: row.id, direction: "in", amountCents: body.openingCents, description: "Saldo de apertura", occurredOn: new Date().toISOString().slice(0, 10), createdBy: auth.user.id });
      }
      const closeSummary = `Cerró ${row.name}. Esperado ${formatMoney(system)}. Contado ${formatMoney(body.countedCents ?? 0)}. ${cajaDifferenceText(system, body.countedCents ?? 0)}`;
      await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: open ? "caja.abrir" : "caja.cerrar", entity: "caja", entityId: row.id, summary: open ? `Abrió la caja ${row.name}` : closeSummary });
      return ok(row);
    });
  }
  if (method === "POST" && action === "movimientos") {
    const auth = await requirePermission("caja", "crear");
    const body = await readBody(req, zCash);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const cashAccountId = body.cashAccountId ?? (await openCashAccount(tx, auth.company.companyId));
      if (body.direction === "out") {
        const [flags] = await tx.execute<{ allow_negative_cash: boolean }>(sql`select allow_negative_cash from companies where id = ${auth.company.companyId}`);
        const totals = await tx.execute<{ balance: string }>(sql`
          select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::text as balance
          from cash_movements where cash_account_id = ${cashAccountId}
        `);
        const blocked = cashOutAllowed(Number(totals[0]?.balance ?? 0), body.amountCents, Boolean(flags?.allow_negative_cash));
        if (blocked) throw new HttpError(409, blocked);
      }
      const [row] = await tx
        .insert(cashMovements)
        .values({
          companyId: auth.company.companyId,
          cashAccountId,
          direction: body.direction,
          amountCents: body.amountCents,
          description: body.description,
          occurredOn: body.occurredOn,
          createdBy: auth.user.id,
        })
        .returning();
      if (body.partyId && body.partyType) {
        await tx.insert(currentAccountEntries).values({
          companyId: auth.company.companyId,
          partyType: body.partyType,
          partyId: body.partyId,
          occurredOn: body.occurredOn,
          description: body.description,
          debitCents: body.partyType === "supplier" ? body.amountCents : 0,
          creditCents: body.partyType === "customer" ? body.amountCents : 0,
        });
      }
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "caja.movimiento",
        entity: "caja",
        entityId: row.id,
        summary: `${body.direction === "in" ? "Ingreso" : "Egreso"} de caja: ${body.description}`,
      });
      return ok(row);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

const zCash = z.object({
  cashAccountId: z.string().uuid().optional(),
  direction: z.enum(["in", "out"]),
  amountCents: z.number(),
  description: z.string().trim().min(1).max(180),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partyType: z.enum(["customer", "supplier"]).optional(),
  partyId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  const message = moneyError(value.amountCents);
  if (message) ctx.addIssue({ code: "custom", message });
});

async function cuentas(method: string, action: string | undefined, req: Request, url: URL) {
  if (method === "GET" && !action) {
    const auth = await requirePermission("cuentas_corrientes", "ver");
    const partyType = url.searchParams.get("partyType") === "supplier" ? "supplier" : "customer";
    const partyModule = partyType === "supplier" ? "proveedores" : "clientes";
    if (!can(auth.permissions, partyModule, "ver")) throw new HttpError(403, "No tenés permiso para hacer eso");
    const partyId = url.searchParams.get("partyId");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      if (partyId) {
        const entries = await tx
          .select()
          .from(currentAccountEntries)
          .where(and(eq(currentAccountEntries.companyId, auth.company.companyId), eq(currentAccountEntries.partyType, partyType), eq(currentAccountEntries.partyId, partyId)))
          .orderBy(desc(currentAccountEntries.occurredOn), desc(currentAccountEntries.createdAt))
          .limit(100);
        return ok({ entries });
      }
      const rows = await tx.execute<{ id: string; name: string; balance: string }>(sql`
        select p.id, p.name, coalesce(sum(e.debit_cents - e.credit_cents), 0)::text as balance
          from ${sql.raw(partyType === "customer" ? "customers" : "suppliers")} p
          left join current_account_entries e
            on e.party_id = p.id and e.party_type = ${partyType} and e.company_id = p.company_id
         where p.company_id = ${auth.company.companyId}
         group by p.id, p.name
         order by p.name
      `);
      return ok({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          balanceCents: partyType === "supplier" ? -Number(row.balance) : Number(row.balance),
        })),
      });
    });
  }
  if (method === "POST" && action === "cobro") {
    const auth = await requirePermission("cuentas_corrientes", "crear");
    if (!can(auth.permissions, "caja", "crear")) throw new HttpError(403, "Para cobrar también necesitás permiso de caja");
    const body = await readBody(req, zCobro);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const balance = await tx.execute<{ balance: string }>(sql`
        select coalesce(sum(debit_cents - credit_cents), 0)::text as balance
        from current_account_entries
        where company_id = ${auth.company.companyId} and party_type = ${body.partyType} and party_id = ${body.partyId}
      `);
      const outstanding = body.partyType === "supplier" ? -Number(balance[0]?.balance ?? 0) : Number(balance[0]?.balance ?? 0);
      const blocked = collectionAllowed(outstanding, body.amountCents, Boolean(body.anticipo));
      if (blocked) throw new HttpError(409, blocked);
      if (body.partyType === "customer" && (body.description === "Recibo" || body.description.startsWith("Recibo"))) {
        const [dtype] = await tx.execute<{ id: string }>(sql`
          select id::text from document_types where company_id = ${auth.company.companyId} and code = 'REC' and active limit 1
        `);
        if (!dtype) throw new HttpError(400, "Falta el comprobante REC. Creá el recibo en Comprobantes.");
        const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
          kind: "venta",
          documentTypeId: dtype.id,
          partyId: body.partyId,
          issuedOn: body.occurredOn,
          paymentMethod: "contado",
          collectCash: true,
          cashAccountId: body.cashAccountId,
          notes: "Recibo",
          lines: [{ description: "Cobro", quantity: 1, unitPriceCents: body.amountCents, discountBps: 0, ivaRateBps: 0 }],
        });
        await writeAudit(tx, {
          companyId: auth.company.companyId,
          userId: auth.user.id,
          action: "cuenta.cobro",
          entity: "cuentas_corrientes",
          entityId: body.partyId,
          summary: created.label,
        });
        return ok(created);
      }
      const numbered = body.description === "Orden de pago";
      const seq = numbered
        ? await tx.execute<{ n: number }>(sql`select count(*)::int as n from current_account_entries where company_id = ${auth.company.companyId} and description like ${"Orden de pago %"}`)
        : [];
      const description = numbered ? `Orden de pago ${Number(seq[0]?.n ?? 0) + 1}` : body.description;
      const [cash] = await tx
        .insert(cashMovements)
        .values({
          companyId: auth.company.companyId,
          cashAccountId: body.cashAccountId ?? (await openCashAccount(tx, auth.company.companyId)),
          direction: cashDirectionForParty(body.partyType),
          amountCents: body.amountCents,
          description,
          occurredOn: body.occurredOn,
          createdBy: auth.user.id,
        })
        .returning();
      await tx.insert(currentAccountEntries).values({
        companyId: auth.company.companyId,
        partyType: body.partyType,
        partyId: body.partyId,
        occurredOn: body.occurredOn,
        description,
        debitCents: body.partyType === "supplier" ? body.amountCents : 0,
        creditCents: body.partyType === "customer" ? body.amountCents : 0,
      });
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "cuenta.cobro",
        entity: "cuentas_corrientes",
        entityId: body.partyId,
        summary: body.description,
      });
      return ok(cash);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

const zCobro = z.object({
  partyType: z.enum(["customer", "supplier"]),
  partyId: z.string().uuid(),
  cashAccountId: z.string().uuid().optional(),
  amountCents: z.number(),
  description: z.string().trim().min(1).max(180),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  anticipo: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  const message = moneyError(value.amountCents);
  if (message) ctx.addIssue({ code: "custom", message });
});

async function listas(method: string, id: string | undefined, action: string | undefined, req: Request) {
  if (method === "GET" && !id) {
    const auth = await requirePermission("articulos", "ver");
    const url = new URL(req.url);
    const page = pageParams(url, 40);
    const listId = url.searchParams.get("lista") ?? "";
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const lists = await tx.select().from(priceLists).where(eq(priceLists.companyId, auth.company.companyId)).orderBy(asc(priceLists.name));
      const chosen = lists.find((list) => list.id === listId) ?? lists.find((list) => list.isDefault) ?? lists[0];
      const term = page.q ? likeTerm(page.q) : "";
      const items = chosen
        ? await tx.execute<{ product_id: string; sku: string; name: string; price_cents: string | null; total: string }>(sql`
            select p.id::text as product_id, p.sku, p.name, pp.price_cents::text as price_cents, count(*) over()::text as total
            from products p
            left join product_prices pp on pp.product_id = p.id and pp.price_list_id = ${chosen.id}
            where p.company_id = ${auth.company.companyId} and p.active
              and (${term} = '' or p.sku ilike ${term} or p.name ilike ${term})
            order by p.sku
            limit ${page.pageSize} offset ${page.offset}
          `)
        : [];
      return ok({
        lists,
        items,
        total: Number(items[0]?.total ?? 0),
        page: page.page,
        pageSize: page.pageSize,
        listId: chosen?.id ?? "",
        canEdit: can(auth.permissions, "articulos", "editar"),
        canCreate: can(auth.permissions, "articulos", "crear"),
      });
    });
  }
  if (method === "POST" && !id) {
    const auth = await requirePermission("articulos", "crear");
    const body = await readBody(req, z.object({ name: z.string().trim().min(1).max(80) }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.insert(priceLists).values({ companyId: auth.company.companyId, name: body.name, isDefault: false }).returning();
      return ok(row);
    });
  }
  if (method === "PATCH" && id && !action) {
    const auth = await requirePermission("articulos", "editar");
    const body = await readBody(req, z.object({ name: z.string().trim().min(1).max(80).optional(), isDefault: z.boolean().optional() }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      if (body.isDefault) await tx.update(priceLists).set({ isDefault: false }).where(eq(priceLists.companyId, auth.company.companyId));
      const [row] = await tx.update(priceLists).set({ ...(body.name ? { name: body.name } : {}), ...(body.isDefault != null ? { isDefault: body.isDefault } : {}) }).where(and(eq(priceLists.id, id), eq(priceLists.companyId, auth.company.companyId))).returning();
      if (!row) throw new HttpError(404, "No encontramos la lista");
      return ok(row);
    });
  }
  if (method === "POST" && id && action === "precios") {
    const auth = await requirePermission("articulos", "editar");
    const body = await readBody(req, z.object({ productId: z.string().uuid(), priceCents: z.number().int().min(0) }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      await tx.execute(sql`
        insert into product_prices (product_id, price_list_id, company_id, price_cents)
        values (${body.productId}::uuid, ${id}::uuid, ${auth.company.companyId}, ${body.priceCents})
        on conflict (product_id, price_list_id) do update set price_cents = excluded.price_cents
      `);
      return ok({ saved: true });
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function contabilidad(method: string, id: string | undefined, req: Request) {
  if (method === "GET") {
    const auth = await requirePermission("contabilidad", "ver");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.companyId, auth.company.companyId)).orderBy(asc(ledgerAccounts.code));
      return ok({ accounts });
    });
  }
  if (method === "POST") {
    const auth = await requirePermission("contabilidad", "crear");
    const body = await readBody(
      req,
      z.object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(120),
        parentCode: z.string().trim().max(20).optional().default(""),
        kind: z.enum(["activo", "pasivo", "patrimonio", "ingreso", "egreso"]),
        imputable: z.boolean().optional().default(true),
      }),
    );
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .insert(ledgerAccounts)
        .values({
          companyId: auth.company.companyId,
          code: body.code,
          name: body.name,
          parentCode: body.parentCode || null,
          kind: body.kind,
          imputable: body.imputable,
        })
        .returning();
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "contabilidad.crear",
        entity: "contabilidad",
        entityId: row.id,
        summary: `Alta de cuenta ${body.code} ${body.name}`,
      });
      return ok(row);
    });
  }
  if (method === "PATCH" && id) {
    const auth = await requirePermission("contabilidad", "editar");
    const body = await readBody(req, z.object({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["activo", "pasivo", "patrimonio", "ingreso", "egreso"]),
      imputable: z.boolean(),
    }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.update(ledgerAccounts).set({ name: body.name, kind: body.kind, imputable: body.imputable }).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.companyId, auth.company.companyId))).returning();
      if (!row) throw new HttpError(404, "No encontramos la cuenta");
      return ok(row);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function derivar(req: Request, id: string) {
    const body = await readBody(req, z.object({ target: z.enum(["remito", "venta", "nota"]) }));
  const targetKind = body.target === "remito" ? "remito" : "venta";
  const auth = await requirePermission(targetKind === "remito" ? "remitos" : "ventas", "crear");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const source = await getDocument(tx, auth.company.companyId, id);
    if (!source || source.status !== "confirmado") throw new HttpError(404, "No encontramos el comprobante");
    const sourceKind = source.kind;
    if (body.target === "nota") {
      if (sourceKind !== "venta" || source.typeCode === "NCR") throw new HttpError(400, "La nota de crédito se emite desde la factura original");
    } else if (sourceKind !== "pedido" && !(sourceKind === "remito" && targetKind === "venta")) {
      throw new HttpError(400, "Desde un pedido se remite o se factura. Desde un remito, solo se factura.");
    }
    if (!source.partyId) throw new HttpError(400, "El comprobante no tiene cuenta");
    const blocked = invoiceBlocked(sourceKind, source.derived.map((item) => item.kind));
    if (body.target === "venta" && blocked) throw new HttpError(409, blocked);
    const taken = await tx.execute<{ id: string }>(sql`
      select id::text from documents where company_id = ${auth.company.companyId} and source_document_id = ${id}::uuid and kind = ${targetKind} and status = 'confirmado' limit 1
    `);
    if (taken[0]) throw new HttpError(409, "Ese comprobante ya fue derivado");
    if (sourceKind === "pedido" && targetKind === "venta") {
      const viaRemito = await tx.execute<{ id: string }>(sql`
        select fac.id::text
        from documents rem
        join documents fac on fac.company_id = rem.company_id
          and fac.source_document_id = rem.id
          and fac.kind = 'venta'
          and fac.status = 'confirmado'
        where rem.company_id = ${auth.company.companyId}
          and rem.source_document_id = ${id}::uuid
          and rem.kind = 'remito'
          and rem.status = 'confirmado'
        limit 1
      `);
      if (viaRemito[0]) throw new HttpError(409, "Ese pedido ya se facturó desde el remito");
    }
    const code = body.target === "nota" ? "NCR" : targetKind === "remito" ? "REM" : "FAC";
    const [dtype] = await tx.execute<{ id: string; stock_factor: number }>(sql`
      select id::text, stock_factor from document_types
      where company_id = ${auth.company.companyId} and kind = ${targetKind} and active
      order by (code = ${code}) desc, code limit 1
    `);
    if (!dtype) throw new HttpError(400, "Definí el comprobante de destino");
    const skipStock = body.target === "nota" ? false : derivedStockFactor(sourceKind === "remito" ? "remito" : "pedido", targetKind, dtype.stock_factor) === 0;
    const created = await createDocument(tx, { userId: auth.user.id, companyId: auth.company.companyId }, {
      kind: targetKind,
      documentTypeId: dtype.id,
      partyId: source.partyId,
      issuedOn: todayIso(),
      paymentMethod: source.paymentMethod === "contado" ? "contado" : "cuenta_corriente",
      warehouseId: source.warehouseId,
      priceListId: source.priceListId,
      sourceDocumentId: source.id,
      skipStock,
      notes: `Desde ${source.typeCode} ${source.number}`,
      lines: source.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: line.unitPriceCents,
        discountBps: line.discountBps,
        ivaRateBps: line.ivaRateBps,
      })),
    });
    return ok(created);
  });
}

async function openCashAccount(tx: Tx, companyId: string): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id::text from cash_accounts
    where company_id = ${companyId} and active
    order by (kind = 'caja') desc, name
    limit 1
  `);
  const id = rows[0]?.id;
  if (!id) throw new HttpError(400, "No hay una caja abierta. Creala en Caja antes de anotar.");
  return id;
}

async function auditoria(method: string, url: URL) {
  if (method !== "GET") throw new HttpError(404, "No existe esa ruta");
  const auth = await requirePermission("auditoria", "ver");
  const page = pageParams(url);
  const desde = url.searchParams.get("desde") ?? "";
  const hasta = url.searchParams.get("hasta") ?? "";
  const action = (url.searchParams.get("accion") ?? "").trim().slice(0, 40);
  const entity = (url.searchParams.get("entidad") ?? "").slice(0,80);
  const record = (url.searchParams.get("registro") ?? "").slice(0,100);
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const term = page.q ? likeTerm(page.q) : "";
    const where = and(
      eq(auditLog.companyId, auth.company.companyId),
      entity ? eq(auditLog.entity,entity) : undefined,
      record ? eq(auditLog.entityId,record) : undefined,
      term ? or(ilike(auditLog.summary, term), ilike(auditLog.action, term), ilike(users.name, term)) : undefined,
      action ? ilike(auditLog.action, `${action}%`) : undefined,
      desde ? sql`${auditLog.createdAt} >= ${desde}::date` : undefined,
      hasta ? sql`${auditLog.createdAt} < (${hasta}::date + interval '1 day')` : undefined,
    );
    const [items, countRows] = await Promise.all([
      tx
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entity: auditLog.entity,
          summary: auditLog.summary,
          changes: sql`coalesce(${auditLog.metadata}->'changes','[]'::jsonb)`,
          createdAt: auditLog.createdAt,
          userName: users.name,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(where),
    ]);
    return ok({ items, total: Number(countRows[0]?.total ?? 0), page: page.page, pageSize: page.pageSize });
  });
}

async function configuracion(method: string, req: Request) {
  if (method === "GET") {
    const auth = await requirePermission("configuracion", "ver");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, auth.company.companyId));
      const [fields, rubros, roleRows, memberRows] = await Promise.all([
        tx.select().from(customFieldDefs).where(eq(customFieldDefs.companyId, auth.company.companyId)).orderBy(asc(customFieldDefs.position)),
        tx.select().from(categories).where(eq(categories.companyId, auth.company.companyId)).orderBy(asc(categories.name)),
        tx.select().from(roles).where(eq(roles.companyId, auth.company.companyId)).orderBy(asc(roles.name)),
        tx
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            active: memberships.active,
            roleId: roles.id,
            roleName: roles.name,
            roleKey: roles.key,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .where(eq(memberships.companyId, auth.company.companyId))
          .orderBy(asc(users.name)),
      ]);
      const perms = roleRows.length
        ? await tx.select().from(rolePermissions).where(sql`${rolePermissions.roleId} in (${sql.join(roleRows.map((role) => sql`${role.id}`), sql`, `)})`)
        : [];
      return ok({
        company,
        modules: MODULES,
        fields,
        categories: rubros,
        users: memberRows,
        roles: roleRows.map((role) => ({
          ...role,
          permissions: perms.filter((item) => item.roleId === role.id).map((item) => item.permission),
        })),
        canEdit: can(auth.permissions, "configuracion", "editar"),
      });
    });
  }
  if (method === "PATCH") {
    const auth = await requirePermission("configuracion", "editar");
    const body = await readBody(req, companySchema);
    const allowed = new Set<string>(MODULES.filter((moduleKey) => moduleKey.toggle).map((moduleKey) => moduleKey.key));
    const enabledModules = body.enabledModules.filter((moduleKey) => allowed.has(moduleKey as ModuleKey));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .update(companies)
        .set({
          name: body.name,
          legalName: body.legalName,
          phone: body.phone || null,
          email: body.email || null,
          address: body.address || null,
          city: body.city || null,
          province: body.province || null,
          pointOfSale: body.pointOfSale,
          blockNegativeStock: body.blockNegativeStock,
          allowNegativeCash: body.allowNegativeCash,
          enabledModules,
        })
        .where(eq(companies.id, auth.company.companyId))
        .returning();
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "configuracion.editar",
        entity: "empresa",
        entityId: auth.company.companyId,
        summary: "Actualizó los datos y módulos de la empresa",
      });
      return ok(row);
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function campos(method: string, id: string | undefined, req: Request) {
  if (method === "POST") {
    const auth = await requirePermission("configuracion", "editar");
    const body = await readBody(
      req,
      z.object({
        entity: z.enum(["cliente", "proveedor", "articulo"]),
        label: z.string().trim().min(1).max(80),
        fieldType: z.enum(["text", "number", "date"]),
        required: z.boolean().optional().default(false),
      }),
    );
    const key = body.label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .insert(customFieldDefs)
        .values({
          companyId: auth.company.companyId,
          entity: body.entity,
          key: key || "campo",
          label: body.label,
          fieldType: body.fieldType,
          required: body.required,
        })
        .returning();
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "campo.crear",
        entity: "campo",
        entityId: row.id,
        summary: `Creó el campo ${body.label}`,
      });
      return ok(row);
    });
  }
  if (method === "DELETE" && id) {
    const auth = await requirePermission("configuracion", "editar");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx
        .delete(customFieldDefs)
        .where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.companyId, auth.company.companyId)))
        .returning();
      if (!row) throw new HttpError(404, "No encontramos el campo");
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "campo.borrar",
        entity: "campo",
        entityId: id,
        summary: `Eliminó el campo ${row.label}`,
      });
      return ok({ id });
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function rubros(method: string, id: string | undefined, req: Request) {
  if (method === "POST") {
    const auth = await requirePermission("configuracion", "editar");
    const body = await readBody(req, z.object({ kind: z.enum(["articulo", "cliente"]), name: z.string().trim().min(1).max(80) }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [row] = await tx.insert(categories).values({ companyId: auth.company.companyId, kind: body.kind, name: body.name }).returning();
      return ok(row);
    });
  }
  if (method === "DELETE" && id) {
    const auth = await requirePermission("configuracion", "editar");
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      await tx.delete(categories).where(and(eq(categories.id, id), eq(categories.companyId, auth.company.companyId)));
      return ok({ id });
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function usuarios(method: string, req: Request) {
  if (method === "PATCH") return updateUsuario(req);
  if (method !== "POST") throw new HttpError(404, "No existe esa ruta");
  const auth = await requirePermission("configuracion", "crear");
  const body = await readBody(
    req,
    z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().email(),
      password: z.string().min(6, "La clave tiene que tener al menos 6 caracteres").optional(),
      roleId: z.string().uuid(),
    }),
  );
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const [role] = await tx.select().from(roles).where(and(eq(roles.id, body.roleId), eq(roles.companyId, auth.company.companyId)));
    if (!role) throw new HttpError(400, "Ese puesto no es de esta empresa");
    const attached = await tx.execute<{ auth_attach_user: string | null }>(sql`select auth_attach_user(${body.email}, ${body.roleId}::uuid)`);
    const existingId = attached[0]?.auth_attach_user;
    if (existingId) {
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "usuario.sumar",
        entity: "usuario",
        entityId: existingId,
        summary: `Sumó a ${body.email} como ${role.name}`,
      });
      return ok({ id: existingId, email: body.email.toLowerCase(), attached: true });
    }
    if (!body.password) throw new HttpError(400, "Para un usuario nuevo hace falta una clave de al menos 6 caracteres");
    const created = await tx.execute<{ auth_create_user: string }>(sql`
      select auth_create_user(${body.name}, ${body.email}, ${hashPassword(body.password)}, ${body.roleId}::uuid) as auth_create_user
    `);
    const userId = created[0]?.auth_create_user;
    if (!userId) throw new HttpError(500, "No se pudo crear el usuario");
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "usuario.crear",
      entity: "usuario",
      entityId: userId,
      summary: `Invitó a ${body.name} como ${role.name}`,
    });
    return ok({ id: userId, name: body.name, email: body.email.toLowerCase() });
  });
}

async function updateUsuario(req: Request) {
  const auth = await requirePermission("configuracion", "editar");
  const body = await readBody(req, z.object({
    userId: z.string().uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    roleId: z.string().uuid().optional(),
    password: z.string().min(6, "La clave tiene que tener al menos 6 caracteres").optional(),
    active: z.boolean().optional(),
  }));
  if (body.userId === auth.user.id && body.active === false) throw new HttpError(400, "No te desactives a vos mismo");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const member = await tx.execute<{ id: string }>(sql`
      select user_id::text as id from memberships where company_id = ${auth.company.companyId} and user_id = ${body.userId}::uuid
    `);
    if (!member[0]) throw new HttpError(404, "Esa persona no está en la empresa");
    if (body.roleId) {
      const [role] = await tx.select().from(roles).where(and(eq(roles.id, body.roleId), eq(roles.companyId, auth.company.companyId)));
      if (!role) throw new HttpError(400, "Ese puesto no es de esta empresa");
      await tx.execute(sql`update memberships set role_id = ${body.roleId}::uuid where company_id = ${auth.company.companyId} and user_id = ${body.userId}::uuid`);
    }
    if (body.active != null) {
      await tx.execute(sql`update memberships set active = ${body.active} where company_id = ${auth.company.companyId} and user_id = ${body.userId}::uuid`);
    }
    if (body.name || body.password) {
      await tx.execute(sql`
        update users
        set name = coalesce(${body.name ?? null}, name),
            password_hash = coalesce(${body.password ? hashPassword(body.password) : null}, password_hash)
        where id = ${body.userId}::uuid
      `);
    }
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "usuario.editar",
      entity: "usuario",
      entityId: body.userId,
      summary: body.active === false ? "Desactivó un usuario" : "Actualizó un usuario",
    });
    return ok({ id: body.userId });
  });
}

async function rolesRoute(method: string, id: string | undefined, req: Request) {
  if (method === "PATCH" && id) {
    const auth = await requirePermission("configuracion", "editar");
    const body = await readBody(
      req,
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(240).optional().default(""),
        permissions: z.array(z.string()).max(200),
      }),
    );
    const universe = new Set(allPermissions());
    const permissions = [...new Set(body.permissions.filter((item) => universe.has(item)))];
    if (id === auth.company.roleId && !permissions.includes("configuracion.editar")) {
      throw new HttpError(400, "No te saques el permiso de editar la configuración: te quedarías afuera.");
    }
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const [role] = await tx
        .update(roles)
        .set({ name: body.name, description: body.description, isSystem: false })
        .where(and(eq(roles.id, id), eq(roles.companyId, auth.company.companyId)))
        .returning();
      if (!role) throw new HttpError(404, "No encontramos el puesto");
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (permissions.length) {
        await tx.insert(rolePermissions).values(permissions.map((permission) => ({ roleId: id, permission })));
      }
      await writeAudit(tx, {
        companyId: auth.company.companyId,
        userId: auth.user.id,
        action: "rol.editar",
        entity: "rol",
        entityId: id,
        summary: `Actualizó el puesto ${body.name}`,
      });
      return ok({ ...role, permissions });
    });
  }
  throw new HttpError(404, "No existe esa ruta");
}

async function comprobante(method: string, id: string | undefined, req: Request) {
  if (method === "POST" && !id) {
    const auth = await requirePermission("comprobantes", "crear");
    const body = await readBody(req, z.object({
      code: z.string().trim().min(2).max(8),
      name: z.string().trim().min(1).max(80),
      kind: z.enum(["venta", "compra", "pedido", "remito"]),
      sign: z.number().int().min(-1).max(1).default(1),
      movesStock: z.boolean().default(false),
      stockFactor: z.number().int().min(-1).max(1).default(0),
      movesAccount: z.boolean().default(false),
      accountSide: z.enum(["debit", "credit"]).nullable().optional(),
      movesCash: z.boolean().default(false),
      cashDirection: z.enum(["in", "out"]).nullable().optional(),
      movesVat: z.boolean().default(false),
    }));
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const code = body.code.toUpperCase();
      const taken = await tx.execute(sql`select 1 from document_types where company_id = ${auth.company.companyId} and code = ${code}`);
      if (taken.length) throw new HttpError(409, "Ya existe un comprobante con ese código");
      const stockMove = body.kind === "venta" || body.kind === "remito";
      const [row] = await tx.insert(documentTypes).values({
        companyId: auth.company.companyId,
        code,
        name: body.name,
        kind: body.kind,
        sign: body.sign,
        movesStock: stockMove ? true : body.movesStock,
        stockFactor: stockMove ? ((body.sign ?? 1) < 0 ? 1 : -1) : body.stockFactor,
        movesAccount: body.movesAccount,
        accountSide: body.accountSide ?? null,
        movesCash: body.movesCash,
        cashDirection: body.cashDirection ?? null,
        movesVat: body.movesVat,
        afipCodes: {},
      }).returning();
      await writeAudit(tx, { companyId: auth.company.companyId, userId: auth.user.id, action: "comprobante.crear", entity: "comprobante", entityId: row.id, summary: `Creó el comprobante ${row.code}` });
      return ok(row);
    });
  }
  if (method !== "PATCH" || !id) throw new HttpError(404, "No existe esa ruta");
  const auth = await requirePermission("comprobantes", "editar");
  const body = await readBody(
    req,
    z.object({
      name: z.string().trim().min(1).max(80),
      active: z.boolean(),
      electronic: z.boolean(),
      nextNumber: z.number().int().min(1).max(99_999_999),
    }),
  );
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const [row] = await tx
      .update(documentTypes)
      .set({ name: body.name, active: body.active, electronic: body.electronic, nextNumber: body.nextNumber })
      .where(and(eq(documentTypes.id, id), eq(documentTypes.companyId, auth.company.companyId)))
      .returning();
    if (!row) throw new HttpError(404, "No encontramos el comprobante");
    await writeAudit(tx, {
      companyId: auth.company.companyId,
      userId: auth.user.id,
      action: "comprobante.editar",
      entity: "comprobante",
      entityId: id,
      summary: `Actualizó ${row.code} ${body.name}`,
    });
    return ok(row);
  });
}

