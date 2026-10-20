import { and, eq, sql } from "drizzle-orm";
import { cuitDigits, formatCuit, isValidCuit } from "@/lib/fiscal/cuit";
import type { TaxCondition } from "@/lib/fiscal/letter";
import { priceModeForLetter } from "@/lib/fiscal/letter";
import type { Tx } from "@/lib/db/tenant";
import {
  categories,
  currentAccountEntries,
  customFieldValues,
  customers,
  documentLines,
  documentTaxes,
  documentTypes,
  documents,
  ledgerAccounts,
  priceLists,
  productPrices,
  products,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "@/lib/db/schema";
import type { EntityKey } from "@/lib/io/fields";
import { parseAmount, parseTaxCondition, rateBps, rowKey } from "@/lib/io/validate";

type UndoOp =
  | { op: "delete"; table: string; id: string }
  | { op: "update"; table: string; id: string; before: Record<string, unknown> }
  | { op: "stock"; productId: string; warehouseId: string; before: number };

export type CommitRow = {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
  duplicate: boolean;
  missingIva: boolean;
  rowKey: string;
};

export type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  messages: string[];
};

type Mode = "omitir" | "actualizar" | "crear";

export async function commitRows(
  tx: Tx,
  ctx: { companyId: string; userId: string; pointOfSale: number },
  entity: EntityKey,
  rows: CommitRow[],
  options: { duplicateMode: Mode; afectaCuenta: boolean },
): Promise<{ results: Map<number, { action: string; undo: UndoOp[]; error?: string }>; summary: CommitResult }> {
  const matches = await loadMatches(tx, ctx.companyId, entity);
  const partyCache = entity === "compras"
    ? await tx.select().from(suppliers).where(eq(suppliers.companyId, ctx.companyId))
    : entity === "ventas"
      ? await tx.select().from(customers).where(eq(customers.companyId, ctx.companyId))
      : [];
  const lists = await tx.select().from(priceLists).where(eq(priceLists.companyId, ctx.companyId));
  const deps = await tx.select().from(warehouses).where(eq(warehouses.companyId, ctx.companyId));
  const rubros = await tx.select().from(categories).where(eq(categories.companyId, ctx.companyId));
  const types = await tx.select().from(documentTypes).where(eq(documentTypes.companyId, ctx.companyId));
  const results = new Map<number, { action: string; undo: UndoOp[]; error?: string }>();
  const summary: CommitResult = { created: 0, updated: 0, skipped: 0, failed: 0, messages: [] };
  let codeCounter = await countParties(tx, ctx.companyId, entity);

  for (const row of rows) {
    if (row.errors.length > 0) {
      results.set(row.rowNumber, { action: "error", undo: [], error: row.errors[0] });
      summary.failed += 1;
      summary.messages.push(`Fila ${row.rowNumber}: omitida, ${row.errors[0]}`);
      continue;
    }
    const key = row.rowKey || rowKey(entity, row.values);
    const existingId = matches.get(key);
    if (existingId && options.duplicateMode === "omitir") {
      results.set(row.rowNumber, { action: "omitido", undo: [] });
      summary.skipped += 1;
      summary.messages.push(`Fila ${row.rowNumber}: salteada, ya existía`);
      continue;
    }
    const save = `row_${row.rowNumber}`;
    await tx.execute(sql`SAVEPOINT ${sql.raw(save)}`);
    try {
      const outcome = await applyRow(tx, ctx, entity, row, existingId && options.duplicateMode === "actualizar" ? existingId : null, {
        lists,
        deps,
        rubros,
        types,
        nextCode: () => {
          codeCounter += 1;
          return codeCounter;
        },
        afectaCuenta: options.afectaCuenta,
        parties: partyCache as { id: string; name: string; cuit: string | null; taxCondition: string }[],
      });
      await tx.execute(sql`RELEASE SAVEPOINT ${sql.raw(save)}`);
      if (outcome.id && key) matches.set(key, outcome.id);
      results.set(row.rowNumber, { action: outcome.action, undo: outcome.undo });
      if (outcome.action === "creado") summary.created += 1;
      else if (outcome.action === "actualizado") summary.updated += 1;
      else {
        summary.skipped += 1;
        summary.messages.push(`Fila ${row.rowNumber}: salteada`);
      }
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.raw(save)}`);
      const message = error instanceof Error ? error.message : "No se pudo guardar la fila";
      results.set(row.rowNumber, { action: "error", undo: [], error: message });
      summary.failed += 1;
      summary.messages.push(`Fila ${row.rowNumber}: ${message}`);
    }
  }
  return { results, summary };
}

async function countParties(tx: Tx, companyId: string, entity: EntityKey): Promise<number> {
  const table = entity === "proveedores" ? "suppliers" : entity === "clientes" ? "customers" : null;
  if (!table) return 0;
  const rows = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} where company_id = '${companyId}'`));
  return Number(rows[0]?.n ?? 0);
}

async function loadMatches(tx: Tx, companyId: string, entity: EntityKey): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (entity === "clientes" || entity === "proveedores") {
    const table = entity === "clientes" ? customers : suppliers;
    const rows = await tx.select({ id: table.id, cuit: table.cuit, code: table.code, name: table.name }).from(table).where(eq(table.companyId, companyId));
    for (const row of rows) {
      const digits = cuitDigits(row.cuit ?? "");
      if (digits.length === 11) map.set(`cuit:${digits}`, row.id);
      map.set(`code:${row.code.toLowerCase()}`, row.id);
      map.set(`name:${row.name.toLowerCase()}`, row.id);
    }
  } else if (entity === "articulos") {
    const rows = await tx.select({ id: products.id, sku: products.sku }).from(products).where(eq(products.companyId, companyId));
    for (const row of rows) map.set(row.sku.toLowerCase(), row.id);
  } else if (entity === "plan") {
    const rows = await tx.select({ id: ledgerAccounts.id, code: ledgerAccounts.code }).from(ledgerAccounts).where(eq(ledgerAccounts.companyId, companyId));
    for (const row of rows) map.set(row.code.toLowerCase(), row.id);
  } else if (entity === "ventas" || entity === "compras") {
    const rows = await tx.execute<{ id: string; key: string }>(sql`
      select d.id::text, lower(dt.code || '|' || coalesce(d.letter, '') || '|' || d.point_of_sale::text || '|' || d.number::text || '|' || regexp_replace(coalesce(d.party_cuit, ''), '\\D', '', 'g')) as key
      from documents d
      join document_types dt on dt.id = d.document_type_id
      where d.company_id = ${companyId} and d.kind = ${entity === "ventas" ? "venta" : "compra"}
    `);
    for (const row of rows) map.set(row.key, row.id);
  }
  return map;
}

async function applyRow(
  tx: Tx,
  ctx: { companyId: string; userId: string; pointOfSale: number },
  entity: EntityKey,
  row: CommitRow,
  existingId: string | null,
  look: {
    lists: { id: string; name: string }[];
    deps: { id: string; name: string }[];
    rubros: { id: string; name: string }[];
    types: { id: string; code: string; kind: string; movesVat: boolean }[];
    nextCode: () => number;
    afectaCuenta: boolean;
    parties: { id: string; name: string; cuit: string | null; taxCondition: string }[];
  },
): Promise<{ action: "creado" | "actualizado" | "omitido"; undo: UndoOp[]; id?: string }> {
  const values = row.values;
  if (entity === "clientes" || entity === "proveedores") return upsertParty(tx, ctx.companyId, entity, values, existingId, look);
  if (entity === "articulos") return upsertProduct(tx, ctx.companyId, values, existingId, look);
  if (entity === "listas") return upsertPrice(tx, ctx.companyId, values, look.lists);
  if (entity === "stock") return setStock(tx, ctx, values, look.deps);
  if (entity === "plan") return upsertAccount(tx, ctx.companyId, values, existingId);
  return insertDocument(tx, ctx, entity, values, existingId, look);
}

async function upsertParty(
  tx: Tx,
  companyId: string,
  entity: "clientes" | "proveedores",
  values: Record<string, string>,
  existingId: string | null,
  look: { lists: { id: string; name: string }[]; nextCode: () => number },
): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  const condition = (parseTaxCondition(values.condicion_iva) || values.condicion_iva) as TaxCondition;
  const cuit = values.cuit && isValidCuit(values.cuit) ? formatCuit(values.cuit) : null;
  const list = look.lists.find((item) => item.name.toLowerCase() === (values.lista_precios ?? "").toLowerCase());
  const common = {
    name: values.nombre,
    fantasyName: values.fantasia || null,
    docType: normalizeHeaderDoc(values.tipo_documento, cuit),
    cuit,
    taxCondition: condition,
    address: values.domicilio || null,
    city: values.localidad || null,
    province: values.provincia || null,
    phone: values.telefono || null,
    email: values.email || null,
    paymentTermsDays: Number(values.plazo_pago || 0) || 0,
    notes: values.notas || null,
    active: parseBool(values.activo, true),
  };
  if (existingId) {
    if (entity === "clientes") {
      const [before] = await tx.select().from(customers).where(eq(customers.id, existingId));
      await tx.update(customers).set({
        ...common,
        iibb: values.ingresos_brutos || null,
        iibbPerceptionBps: values.percepcion_iibb ? Math.round(Number(values.percepcion_iibb.replace(",", ".")) * 100) : null,
        postalCode: values.codigo_postal || null,
        contact: values.contacto || null,
        priceListId: list?.id ?? null,
        discountBps: percentBps(values.descuento),
        creditLimitCents: parseAmount(values.limite_credito ?? "") ?? 0,
        zone: values.zona || null,
      }).where(eq(customers.id, existingId));
      await saveFields(tx, companyId, existingId, values);
      return { action: "actualizado", id: existingId, undo: [{ op: "update", table: "customers", id: existingId, before: before as unknown as Record<string, unknown> }] };
    }
    const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, existingId));
    await tx.update(suppliers).set(common).where(eq(suppliers.id, existingId));
    await saveFields(tx, companyId, existingId, values);
    return { action: "actualizado", id: existingId, undo: [{ op: "update", table: "suppliers", id: existingId, before: before as unknown as Record<string, unknown> }] };
  }
  const code = values.codigo || `${entity === "clientes" ? "C" : "P"}${String(9000 + look.nextCode()).padStart(4, "0")}`;
  if (entity === "clientes") {
    const [created] = await tx.insert(customers).values({
      companyId,
      code,
      ...common,
      iibb: values.ingresos_brutos || null,
      iibbPerceptionBps: values.percepcion_iibb ? Math.round(Number(values.percepcion_iibb.replace(",", ".")) * 100) : null,
      postalCode: values.codigo_postal || null,
      contact: values.contacto || null,
      priceListId: list?.id ?? null,
      discountBps: percentBps(values.descuento),
      creditLimitCents: parseAmount(values.limite_credito ?? "") ?? 0,
      zone: values.zona || null,
    }).returning();
    await saveFields(tx, companyId, created.id, values);
    return { action: "creado", id: created.id, undo: [{ op: "delete", table: "customers", id: created.id }] };
  }
  const [created] = await tx.insert(suppliers).values({ companyId, code, ...common }).returning();
  await saveFields(tx, companyId, created.id, values);
  return { action: "creado", id: created.id, undo: [{ op: "delete", table: "suppliers", id: created.id }] };
}

async function upsertProduct(
  tx: Tx,
  companyId: string,
  values: Record<string, string>,
  existingId: string | null,
  look: { lists: { id: string; name: string }[]; rubros: { id: string; name: string }[]; nextCode: () => number },
): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  const rubro = look.rubros.find((item) => item.name.toLowerCase() === (values.rubro ?? "").toLowerCase());
  const patch = {
    name: values.nombre,
    barcode: values.codigo_barras || null,
    categoryId: rubro?.id ?? null,
    unit: values.unidad || "u",
    ivaRateBps: values.iva ? rateBps(values.iva) ?? 2100 : 2100,
    taxTreatment: treatmentOf(values.tratamiento),
    tracksStock: parseBool(values.mueve_stock, true),
    costCents: parseAmount(values.costo ?? "") ?? 0,
    minStock: Number((values.stock_minimo ?? "0").replace(",", ".")) || 0,
    notes: values.notas || null,
    active: parseBool(values.activo, true),
  };
  let id = existingId;
  let action: "creado" | "actualizado" = "actualizado";
  const undo: UndoOp[] = [];
  if (existingId) {
    const [before] = await tx.select().from(products).where(eq(products.id, existingId));
    await tx.update(products).set(patch).where(eq(products.id, existingId));
    undo.push({ op: "update", table: "products", id: existingId, before: before as unknown as Record<string, unknown> });
  } else {
    const [created] = await tx.insert(products).values({ companyId, sku: values.sku, ...patch }).returning();
    id = created.id;
    action = "creado";
    undo.push({ op: "delete", table: "products", id: created.id });
  }
  if (values.precio && values.lista_precios && id) {
    const list = look.lists.find((item) => item.name.toLowerCase() === values.lista_precios.toLowerCase()) ?? (await createList(tx, companyId, values.lista_precios, undo));
    const price = parseAmount(values.precio) ?? 0;
    const [previous] = await tx.select().from(productPrices).where(and(eq(productPrices.productId, id), eq(productPrices.priceListId, list.id)));
    await tx.execute(sql`
      insert into product_prices (product_id, price_list_id, company_id, price_cents)
      values (${id}, ${list.id}, ${companyId}, ${price})
      on conflict (product_id, price_list_id) do update set price_cents = excluded.price_cents
    `);
    if (previous) undo.push({ op: "update", table: "product_prices", id: `${id}|${list.id}`, before: { priceCents: previous.priceCents } });
  }
  await saveFields(tx, companyId, id!, values);
  return { action, undo, id: id! };
}

async function upsertPrice(tx: Tx, companyId: string, values: Record<string, string>, lists: { id: string; name: string }[]): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  const undo: UndoOp[] = [];
  const list = lists.find((item) => item.name.toLowerCase() === values.lista_precios.toLowerCase()) ?? (await createList(tx, companyId, values.lista_precios, undo));
  const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.companyId, companyId), eq(products.sku, values.sku)));
  if (!product) throw new Error(`No existe el artículo ${values.sku}`);
  const price = parseAmount(values.precio) ?? 0;
  const [previous] = await tx.select().from(productPrices).where(and(eq(productPrices.productId, product.id), eq(productPrices.priceListId, list.id)));
  await tx.execute(sql`
    insert into product_prices (product_id, price_list_id, company_id, price_cents)
    values (${product.id}, ${list.id}, ${companyId}, ${price})
    on conflict (product_id, price_list_id) do update set price_cents = excluded.price_cents
  `);
  if (!previous) undo.push({ op: "delete", table: "product_prices", id: `${product.id}|${list.id}` });
  else undo.push({ op: "update", table: "product_prices", id: `${product.id}|${list.id}`, before: { priceCents: previous.priceCents } });
  return { action: previous ? "actualizado" : "creado", undo, id: product.id };
}

async function setStock(
  tx: Tx,
  ctx: { companyId: string; userId: string },
  values: Record<string, string>,
  deps: { id: string; name: string }[],
): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.companyId, ctx.companyId), eq(products.sku, values.sku)));
  if (!product) throw new Error(`No existe el artículo ${values.sku}`);
  const depot = deps.find((item) => item.name.toLowerCase() === values.deposito.toLowerCase());
  if (!depot) throw new Error(`No existe el depósito ${values.deposito}`);
  const quantity = Number(values.cantidad.replace(",", "."));
  const [previous] = await tx.select().from(stockLevels).where(and(eq(stockLevels.productId, product.id), eq(stockLevels.warehouseId, depot.id)));
  const before = previous ? Number(previous.quantity) : 0;
  await tx.execute(sql`
    insert into stock_levels (product_id, warehouse_id, company_id, quantity)
    values (${product.id}, ${depot.id}, ${ctx.companyId}, ${quantity})
    on conflict (product_id, warehouse_id) do update set quantity = excluded.quantity
  `);
  await tx.insert(stockMovements).values({
    companyId: ctx.companyId,
    productId: product.id,
    warehouseId: depot.id,
    quantity: quantity - before,
    reason: "Importación de stock",
    createdBy: ctx.userId,
  });
  return { action: previous ? "actualizado" : "creado", id: product.id, undo: [{ op: "stock", productId: product.id, warehouseId: depot.id, before }] };
}

async function upsertAccount(tx: Tx, companyId: string, values: Record<string, string>, existingId: string | null): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  const kind = normalizeAccountKind(values.tipo);
  if (existingId) {
    const [before] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, existingId));
    await tx.update(ledgerAccounts).set({
      name: values.nombre,
      parentCode: values.padre || null,
      imputable: parseBool(values.imputable, true),
      kind,
    }).where(eq(ledgerAccounts.id, existingId));
    return { action: "actualizado", id: existingId, undo: [{ op: "update", table: "ledger_accounts", id: existingId, before: before as unknown as Record<string, unknown> }] };
  }
  const [created] = await tx.insert(ledgerAccounts).values({
    companyId,
    code: values.codigo,
    name: values.nombre,
    parentCode: values.padre || null,
    imputable: parseBool(values.imputable, true),
    kind,
  }).returning();
  return { action: "creado", id: created.id, undo: [{ op: "delete", table: "ledger_accounts", id: created.id }] };
}

async function insertDocument(
  tx: Tx,
  ctx: { companyId: string; userId: string; pointOfSale: number },
  entity: "ventas" | "compras",
  values: Record<string, string>,
  existingId: string | null,
  look: { types: { id: string; code: string; kind: string; movesVat: boolean }[]; lists: { id: string; name: string }[]; nextCode: () => number; afectaCuenta: boolean; parties: { id: string; name: string; cuit: string | null; taxCondition: string }[] },
): Promise<{ action: "creado" | "actualizado"; undo: UndoOp[]; id: string }> {
  if (existingId) throw new Error("Ese comprobante ya está cargado. Elegí omitir o actualizá el número.");
  const kind = entity === "ventas" ? "venta" : "compra";
  const code = (values.tipo || "FAC").toUpperCase();
  const dtype = look.types.find((type) => type.code.toUpperCase() === code && type.kind === kind);
  if (!dtype) throw new Error(`No está definido el comprobante ${code}`);
  const party = await findOrCreateParty(tx, ctx.companyId, kind, values, look.nextCode, look.parties);
  const undo: UndoOp[] = [];
  if (party.created) undo.push({ op: "delete", table: kind === "compra" ? "suppliers" : "customers", id: party.id });
  const letter = (values.letra || "").toUpperCase();
  const safeLetter = letter === "A" || letter === "B" || letter === "C" ? letter : null;
  const neto = parseAmount(values.neto ?? "") ?? 0;
  const iva = parseAmount(values.iva ?? "") ?? 0;
  const exento = parseAmount(values.exento ?? "") ?? 0;
  const noGravado = parseAmount(values.no_gravado ?? "") ?? 0;
  const percepciones = parseAmount(values.percepciones ?? "") ?? 0;
  const otros = parseAmount(values.otros ?? "") ?? 0;
  const total = parseAmount(values.total ?? "") ?? 0;
  const issuedOn = parseDate(values.fecha);
  if (!issuedOn) throw new Error("La fecha no se entiende");
  const point = Number(values.punto_venta || ctx.pointOfSale);
  const number = Number(String(values.numero).replace(/\D/g, ""));
  const [created] = await tx.insert(documents).values({
    companyId: ctx.companyId,
    kind,
    documentTypeId: dtype.id,
    letter: safeLetter,
    pointOfSale: point,
    number,
    issuedOn,
    partyType: kind === "compra" ? "supplier" : "customer",
    partyId: party.id,
    partyName: values.nombre || party.name,
    partyCuit: values.cuit && isValidCuit(values.cuit) ? formatCuit(values.cuit) : null,
    partyTaxCondition: parseTaxCondition(values.condicion_iva) || party.taxCondition,
    paymentMethod: normalizeHeaderDoc(values.pago, null).includes("contado") ? "contado" : "cuenta_corriente",
    priceMode: priceModeForLetter(safeLetter, dtype.movesVat),
    status: "confirmado",
    notes: values.notas || "Importado",
    netTaxedCents: neto,
    netUntaxedCents: noGravado,
    exemptCents: exento,
    vatCents: iva,
    perceptionsCents: percepciones,
    otherTaxesCents: otros,
    totalCents: total,
    cae: values.cae || null,
    caeStatus: values.cae ? "autorizado" : "no_electronico",
    createdBy: ctx.userId,
  }).returning();
  const [product] = values.sku
    ? await tx.select().from(products).where(and(eq(products.companyId, ctx.companyId), eq(products.sku, values.sku)))
    : [];
  await tx.insert(documentLines).values({
    companyId: ctx.companyId,
    documentId: created.id,
    position: 1,
    productId: product?.id ?? null,
    sku: product?.sku ?? null,
    description: product?.name ?? "Importado",
    quantity: Number((values.cantidad ?? "1").replace(",", ".")) || 1,
    unitPriceCents: parseAmount(values.precio ?? "") ?? total,
    discountBps: 0,
    ivaRateBps: product?.ivaRateBps ?? 2100,
    taxTreatment: product?.taxTreatment ?? "gravado",
    netCents: neto,
    vatCents: iva,
    exemptCents: exento,
    untaxedCents: noGravado,
    totalCents: total,
  });
  if (percepciones) {
    await tx.insert(documentTaxes).values({
      companyId: ctx.companyId,
      documentId: created.id,
      name: "Percepciones",
      rateBps: 0,
      baseCents: neto,
      amountCents: percepciones,
    });
  }
  if (look.afectaCuenta) {
    await tx.insert(currentAccountEntries).values({
      companyId: ctx.companyId,
      partyType: kind === "compra" ? "supplier" : "customer",
      partyId: party.id,
      documentId: created.id,
      occurredOn: issuedOn,
      description: `Importado ${code} ${number}`,
      debitCents: kind === "venta" ? total : 0,
      creditCents: kind === "compra" ? total : 0,
    });
  }
  await tx.execute(sql`
    update document_types
    set next_number = greatest(next_number, ${number + 1})
    where id = ${dtype.id}
  `);
  undo.push({ op: "delete", table: "documents", id: created.id });
  return { action: "creado", id: created.id, undo };
}

async function findOrCreateParty(
  tx: Tx,
  companyId: string,
  kind: "venta" | "compra",
  values: Record<string, string>,
  nextCode: () => number,
  parties: { id: string; name: string; cuit: string | null; taxCondition: string }[],
): Promise<{ id: string; name: string; taxCondition: string; created: boolean }> {
  const digits = cuitDigits(values.cuit ?? "");
  const found = parties.find((row) => digits.length === 11 && cuitDigits(row.cuit ?? "") === digits) ?? parties.find((row) => row.name.toLowerCase() === (values.nombre ?? "").toLowerCase());
  if (found) return { ...found, created: false };
  if (kind === "compra") {
    const [created] = await tx.insert(suppliers).values({
      companyId,
      code: `P${String(9000 + nextCode()).padStart(4, "0")}`,
      name: values.nombre || "Proveedor importado",
      cuit: digits.length === 11 ? formatCuit(digits) : null,
      taxCondition: parseTaxCondition(values.condicion_iva) || "ri",
    }).returning();
    parties.push(created);
    return { ...created, created: true };
  }
  const [created] = await tx.insert(customers).values({
    companyId,
    code: `C${String(9000 + nextCode()).padStart(4, "0")}`,
    name: values.nombre || "Cliente importado",
    cuit: digits.length === 11 ? formatCuit(digits) : null,
    taxCondition: parseTaxCondition(values.condicion_iva) || "cf",
  }).returning();
  parties.push(created);
  return { ...created, created: true };
}

async function createList(tx: Tx, companyId: string, name: string, undo: UndoOp[]): Promise<{ id: string; name: string }> {
  const [created] = await tx.insert(priceLists).values({ companyId, name, isDefault: false }).returning();
  undo.push({ op: "delete", table: "price_lists", id: created.id });
  return created;
}

async function saveFields(tx: Tx, companyId: string, recordId: string, values: Record<string, string>) {
  const entries = Object.entries(values).filter(([key, value]) => key.startsWith("campo:") && value.trim());
  for (const [key, value] of entries) {
    const fieldId = key.slice("campo:".length);
    await tx.execute(sql`
      insert into custom_field_values (company_id, field_id, record_id, value)
      values (${companyId}, ${fieldId}, ${recordId}, ${value.trim()})
      on conflict (field_id, record_id) do update set value = excluded.value
    `);
  }
}

export async function undoOps(tx: Tx, ctx: { companyId: string; userId: string }, ops: UndoOp[]) {
  for (const op of [...ops].reverse()) {
    if (op.op === "delete" && op.table === "documents") {
      await tx.delete(currentAccountEntries).where(eq(currentAccountEntries.documentId, op.id));
      await tx.delete(documents).where(and(eq(documents.id, op.id), eq(documents.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "customers") {
      await tx.delete(customFieldValues).where(eq(customFieldValues.recordId, op.id));
      await tx.delete(customers).where(and(eq(customers.id, op.id), eq(customers.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "suppliers") {
      await tx.delete(suppliers).where(and(eq(suppliers.id, op.id), eq(suppliers.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "products") {
      await tx.delete(stockMovements).where(eq(stockMovements.productId, op.id));
      await tx.delete(products).where(and(eq(products.id, op.id), eq(products.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "ledger_accounts") {
      await tx.delete(ledgerAccounts).where(and(eq(ledgerAccounts.id, op.id), eq(ledgerAccounts.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "price_lists") {
      await tx.delete(priceLists).where(and(eq(priceLists.id, op.id), eq(priceLists.companyId, ctx.companyId)));
    } else if (op.op === "delete" && op.table === "product_prices") {
      const [productId, priceListId] = op.id.split("|");
      await tx.delete(productPrices).where(and(eq(productPrices.productId, productId), eq(productPrices.priceListId, priceListId)));
    } else if (op.op === "update" && op.table === "product_prices") {
      const [productId, priceListId] = op.id.split("|");
      await tx.update(productPrices).set({ priceCents: Number(op.before.priceCents) }).where(and(eq(productPrices.productId, productId), eq(productPrices.priceListId, priceListId)));
    } else if (op.op === "stock") {
      await tx.execute(sql`
        update stock_levels set quantity = ${op.before}
        where product_id = ${op.productId} and warehouse_id = ${op.warehouseId}
      `);
      await tx.insert(stockMovements).values({
        companyId: ctx.companyId,
        productId: op.productId,
        warehouseId: op.warehouseId,
        quantity: 0,
        reason: "Deshacer importación de stock",
        createdBy: ctx.userId,
      });
    } else if (op.op === "update" && op.table === "customers") {
      const before = op.before;
      await tx.update(customers).set({
        name: String(before.name),
        fantasyName: (before.fantasyName as string | null) ?? null,
        cuit: (before.cuit as string | null) ?? null,
        taxCondition: String(before.taxCondition),
        city: (before.city as string | null) ?? null,
        active: Boolean(before.active),
      }).where(eq(customers.id, op.id));
    } else if (op.op === "update" && op.table === "products") {
      const before = op.before;
      await tx.update(products).set({
        name: String(before.name),
        costCents: Number(before.costCents ?? 0),
        active: Boolean(before.active),
      }).where(eq(products.id, op.id));
    } else if (op.op === "update" && op.table === "ledger_accounts") {
      await tx.update(ledgerAccounts).set({ name: String(op.before.name) }).where(eq(ledgerAccounts.id, op.id));
    }
  }
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normal = value.toLowerCase();
  if (["si", "sí", "true", "1", "activo", "s"].includes(normal)) return true;
  if (["no", "false", "0", "inactivo", "n"].includes(normal)) return false;
  return fallback;
}

function percentBps(value: string | undefined): number {
  if (!value) return 0;
  const amount = Number(value.replace("%", "").replace(",", "."));
  if (!Number.isFinite(amount)) return 0;
  return amount > 100 ? Math.round(amount) : Math.round(amount * 100);
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeHeaderDoc(value: string | undefined, cuit: string | null): string {
  if (!value) return cuit ? "CUIT" : "DNI";
  return value.toUpperCase();
}

function treatmentOf(value: string | undefined): string {
  const normal = (value ?? "").toLowerCase();
  if (normal.includes("exento")) return "exento";
  if (normal.includes("no grav")) return "no_gravado";
  return "gravado";
}

function normalizeAccountKind(value: string | undefined): string {
  const normal = (value ?? "").toLowerCase();
  if (normal.includes("pasivo")) return "pasivo";
  if (normal.includes("patrimonio")) return "patrimonio";
  if (normal.includes("ingreso")) return "ingreso";
  if (normal.includes("egreso") || normal.includes("gasto")) return "egreso";
  return "activo";
}
