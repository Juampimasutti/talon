import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { formatMoney, formatNumber } from "../format";
import { HttpError } from "../http";
import { afipCodeFor, getInvoicingPort } from "../fiscal/arca";
import { documentLetter, isTaxCondition, priceModeForLetter, type PriceMode, type TaxCondition } from "../fiscal/letter";
import { calcDocument, documentPerceptions, type PerceptionInput, type TaxTreatment } from "../fiscal/totals";
import type { Tx } from "../db/tenant";
import {
  cashAccounts,
  cashMovements,
  companies,
  currentAccountEntries,
  customers,
  documentLines,
  documentTaxes,
  documentTypes,
  documents,
  productPrices,
  products,
  stockMovements,
  suppliers,
  warehouses,
} from "../db/schema";
import { creditExceeds } from "../stock-rules";
import { writeAudit } from "./audit";

export type DocumentKind = "venta" | "compra" | "pedido" | "remito";

export type DraftLine = {
  productId?: string | null;
  description?: string;
  quantity: number;
  unitPriceCents?: number;
  discountBps?: number;
  /** Neto del renglón en centavos, ya redondeado. */
  amountCents?: number;
  ivaRateBps?: number;
  sku?: string | null;
};

export type DocumentDraft = {
  kind: DocumentKind;
  documentTypeId: string;
  pointOfSale?: number;
  partyId: string;
  issuedOn: string;
  paymentMethod?: "contado" | "cuenta_corriente";
  priceListId?: string | null;
  warehouseId?: string | null;
  cashAccountId?: string | null;
  letter?: "A" | "B" | "C";
  notes?: string;
  otherTaxesCents?: number;
  acknowledgeCredit?: boolean;
  allowNegativeStock?: boolean;
  skipStock?: boolean;
  sourceDocumentId?: string | null;
  /** Un recibo mueve la caja y la cuenta corriente juntas. */
  collectCash?: boolean;
  cae?: string | null;
  perceptions?: PerceptionInput[];
  supplierPos?: number | null;
  supplierNumber?: number | null;
  lines: DraftLine[];
};

type Party = {
  id: string;
  name: string;
  cuit: string | null;
  taxCondition: TaxCondition;
  priceListId: string | null;
  discountBps: number;
  perceptionBps: number | null;
  creditLimitCents: number;
};

async function applyStock(
  tx: Tx,
  args: {
    companyId: string;
    productId: string;
    warehouseId: string;
    delta: number;
    reason: string;
    documentId: string | null;
    userId: string;
    blockNegative: boolean;
  },
) {
  const delta = args.delta.toFixed(3);
  const updated = await tx.execute<{ quantity: string }>(sql`
    insert into stock_levels (product_id, warehouse_id, company_id, quantity)
    values (${args.productId}, ${args.warehouseId}, ${args.companyId}, ${delta})
    on conflict (product_id, warehouse_id)
    do update set quantity = stock_levels.quantity + excluded.quantity
    returning quantity::text as quantity
  `);
  const quantity = Number(updated[0]?.quantity ?? 0);
  if (args.blockNegative && quantity < -0.0001) {
    throw new HttpError(409, "No hay stock suficiente en el depósito para ese artículo.");
  }
  await tx.insert(stockMovements).values({
    companyId: args.companyId,
    productId: args.productId,
    warehouseId: args.warehouseId,
    quantity: args.delta,
    reason: args.reason,
    documentId: args.documentId,
    createdBy: args.userId,
  });
}

export async function createDocument(tx: Tx, ctx: { userId: string; companyId: string }, input: DocumentDraft) {
  const [company] = await tx.select().from(companies).where(eq(companies.id, ctx.companyId));
  if (!company) throw new HttpError(404, "No encontramos la empresa");
  if (!isTaxCondition(company.taxCondition)) throw new HttpError(400, "La empresa no tiene condición de IVA válida");

  const [dtype] = await tx
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.id, input.documentTypeId), eq(documentTypes.companyId, ctx.companyId), eq(documentTypes.active, true)))
    .for("update");
  if (!dtype || dtype.kind !== input.kind) {
    throw new HttpError(400, "Ese tipo de comprobante no está habilitado");
  }

  const party = await loadParty(tx, ctx.companyId, input.kind, input.partyId);
  const issuer: TaxCondition = input.kind === "compra" ? party.taxCondition : company.taxCondition;
  const receiver: TaxCondition = input.kind === "compra" ? company.taxCondition : party.taxCondition;

  const quote = input.kind === "pedido" || input.kind === "remito";
  const suggested = documentLetter(input.kind, dtype.movesVat, issuer, receiver);
  const letter = input.kind === "compra" && input.letter ? input.letter : suggested;
  let priceMode: PriceMode = "sin_iva";
  if (dtype.movesVat) priceMode = priceModeForLetter(letter, true);
  else if (quote) priceMode = "net";

  const productIds = [...new Set(input.lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
  const productRows = productIds.length
    ? await tx
        .select()
        .from(products)
        .where(and(eq(products.companyId, ctx.companyId), inArray(products.id, productIds)))
    : [];
  const byId = new Map(productRows.map((product) => [product.id, product]));

  const listId = input.priceListId ?? party.priceListId;
  const priceRows =
    listId && productIds.length
      ? await tx
          .select()
          .from(productPrices)
          .where(and(eq(productPrices.priceListId, listId), inArray(productPrices.productId, productIds)))
      : [];
  const priceMap = new Map(priceRows.map((row) => [row.productId, row.priceCents]));

  const prepared = input.lines.map((line, index) => {
    const product = line.productId ? byId.get(line.productId) : undefined;
    if (line.productId && !product) throw new HttpError(400, "Hay un artículo que no existe en esta empresa");
    const fallback = input.kind === "compra" ? product?.costCents : priceMap.get(product?.id ?? "");
    const unitPriceCents = line.unitPriceCents ?? fallback ?? product?.costCents;
    if (unitPriceCents == null) throw new HttpError(400, "Falta el precio de un renglón");
    const description = (line.description ?? product?.name ?? "").trim();
    if (!description) throw new HttpError(400, `El renglón ${index + 1} no tiene descripción`);
    if (!(line.quantity > 0)) throw new HttpError(400, "La cantidad tiene que ser mayor a cero");
    return {
      product,
      description,
      quantity: line.quantity,
      unitPriceCents,
      discountBps: line.discountBps ?? (input.kind === "venta" ? party.discountBps : 0),
      amountCents: line.amountCents,
      ivaRateBps: line.ivaRateBps ?? product?.ivaRateBps ?? 2100,
      taxTreatment: (product?.taxTreatment ?? "gravado") as TaxTreatment,
      sku: line.sku || product?.sku || "",
    };
  });

  const perceptions = documentPerceptions({
    kind: input.kind,
    partyBps: party.perceptionBps,
    explicit: input.perceptions,
  });

  const totals = calcDocument({
    priceMode,
    perceptions,
    otherTaxesCents: dtype.movesVat ? (input.otherTaxesCents ?? 0) : 0,
    lines: prepared.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBps: line.discountBps,
      amountCents: line.amountCents,
      ivaRateBps: line.ivaRateBps,
      taxTreatment: line.taxTreatment,
    })),
  });

  let payment: "contado" | "cuenta_corriente" = input.paymentMethod ?? "cuenta_corriente";
  if (dtype.movesCash && !dtype.movesAccount) payment = "contado";
  if (!dtype.movesCash) payment = "cuenta_corriente";

  if (
    payment === "cuenta_corriente" &&
    dtype.movesAccount &&
    dtype.accountSide === "debit" &&
    party.creditLimitCents > 0 &&
    dtype.sign > 0
  ) {
    const balance = await partyBalance(tx, ctx.companyId, "customer", party.id);
    const next = balance + totals.totalCents;
    if (next > party.creditLimitCents && !input.acknowledgeCredit) {
      throw new HttpError(
        409,
        `Supera el límite de crédito (${formatMoney(party.creditLimitCents)}). El saldo quedaría en ${formatMoney(next)}.`,
        { code: "credit_limit", balanceCents: balance, limitCents: party.creditLimitCents, nextCents: next },
      );
    }
  }

  const warehouse = await resolveWarehouse(tx, ctx.companyId, input.warehouseId);
  if (dtype.movesStock && !warehouse) {
    throw new HttpError(400, "Elegí un depósito. Esta operación mueve stock.");
  }

  if (input.sourceDocumentId && dtype.code === "NCR") {
    const [source] = await tx.execute<{ total_cents: string; code: string }>(sql`
      select d.total_cents::text, t.code
      from documents d
      join document_types t on t.id = d.document_type_id
      where d.id = ${input.sourceDocumentId}::uuid and d.company_id = ${ctx.companyId} and d.status = 'confirmado'
    `);
    if (!source) throw new HttpError(400, "No encontramos la factura de origen");
    if (source.code === "REC") throw new HttpError(400, "Un recibo no lleva nota de crédito. Anulalo para revertir el cobro y el saldo.");
    const credited = await tx.execute<{ total: string }>(sql`
      select coalesce(sum(d.total_cents), 0)::text as total
      from documents d
      join document_types t on t.id = d.document_type_id
      where d.company_id = ${ctx.companyId} and d.source_document_id = ${input.sourceDocumentId}::uuid
        and d.status = 'confirmado' and t.code = 'NCR'
    `);
    if (creditExceeds(Number(source.total_cents), Number(credited[0]?.total ?? 0), totals.totalCents)) {
      throw new HttpError(409, "La nota de crédito supera lo que queda sin acreditar de esa factura");
    }
  }

  if (input.kind === "compra" && input.supplierNumber) {
    const duplicated = await tx.execute<{ id: string }>(sql`
      select id::text from documents
      where company_id = ${ctx.companyId} and kind = 'compra' and status = 'confirmado'
        and party_id = ${party.id} and supplier_pos = ${input.supplierPos ?? 0} and supplier_number = ${input.supplierNumber}
      limit 1
    `);
    if (duplicated[0]) throw new HttpError(409, "Ese proveedor ya tiene una factura con ese número");
  }

  const pointOfSale = input.pointOfSale ?? company.pointOfSale;
  const registered = await tx.execute(sql`select 1 from company_points_of_sale where company_id=${ctx.companyId} and number=${pointOfSale}`);
  if (!registered.length) throw new HttpError(400, "El punto de venta no está habilitado en esta empresa");
  const [counter] = await tx.execute<{ number: number }>(sql`
    insert into document_counters(company_id,document_type_id,point_of_sale,next_number)
    values(${ctx.companyId},${dtype.id},${pointOfSale},${pointOfSale === company.pointOfSale ? dtype.nextNumber + 1 : 2})
    on conflict(company_id,document_type_id,point_of_sale) do update
    set next_number=greatest(document_counters.next_number,${pointOfSale === company.pointOfSale ? dtype.nextNumber : 1})+1
    returning next_number-1 as number
  `);
  const number = counter.number;
  if (pointOfSale === company.pointOfSale) await tx.update(documentTypes).set({ nextNumber: number + 1 }).where(eq(documentTypes.id, dtype.id));

  let caeStatus = dtype.electronic ? "pendiente" : "no_electronico";
  let cae: string | null = input.kind === "compra" ? input.cae?.trim() || null : null;
  if (cae) caeStatus = "autorizado";
  let caeDue: string | null = null;
  if (dtype.electronic && dtype.movesVat && letter && process.env.ARCA_MODE === "live") {
    const authorization = await getInvoicingPort().authorize({
      companyCuit: company.cuit,
      pointOfSale,
      afipCode: afipCodeFor(dtype.afipCodes, letter) ?? 0,
      letter,
      number,
      issuedOn: input.issuedOn,
      receiverCuit: party.cuit,
      receiverTaxCondition: party.taxCondition,
      netTaxedCents: totals.netTaxedCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
    });
    cae = authorization.cae;
    caeDue = authorization.caeDue;
    caeStatus = "autorizado";
  }

  const [document] = await tx
    .insert(documents)
    .values({
      companyId: ctx.companyId,
      kind: input.kind,
      documentTypeId: dtype.id,
      letter,
      pointOfSale,
      number,
      issuedOn: input.issuedOn,
      partyType: input.kind === "compra" ? "supplier" : "customer",
      partyId: party.id,
      partyName: party.name,
      partyCuit: party.cuit,
      partyTaxCondition: party.taxCondition,
      priceListId: listId,
      warehouseId: warehouse?.id ?? null,
      paymentMethod: payment,
      priceMode,
      status: "confirmado",
      notes: input.notes?.trim() || null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      supplierPos: input.kind === "compra" ? input.supplierPos ?? null : null,
      supplierNumber: input.kind === "compra" ? input.supplierNumber ?? null : null,
      netTaxedCents: totals.netTaxedCents,
      netUntaxedCents: totals.netUntaxedCents,
      exemptCents: totals.exemptCents,
      vatCents: totals.vatCents,
      perceptionsCents: totals.perceptionsCents,
      otherTaxesCents: totals.otherTaxesCents,
      totalCents: totals.totalCents,
      cae,
      caeDue,
      caeStatus,
      createdBy: ctx.userId,
    })
    .returning();

  await tx.insert(documentLines).values(
    prepared.map((line, index) => {
      const amounts = totals.lines[index];
      return {
        companyId: ctx.companyId,
        documentId: document.id,
        position: index + 1,
        productId: line.product?.id ?? null,
        sku: line.sku || null,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountBps: line.discountBps,
        ivaRateBps: line.ivaRateBps,
        taxTreatment: line.taxTreatment,
        netCents: amounts.netCents,
        vatCents: amounts.vatCents,
        exemptCents: amounts.exemptCents,
        untaxedCents: amounts.untaxedCents,
        totalCents: amounts.totalCents,
      };
    }),
  );

  if (totals.perceptions.length > 0) {
    await tx.insert(documentTaxes).values(
      totals.perceptions.map((tax) => ({
        companyId: ctx.companyId,
        documentId: document.id,
        name: tax.name,
        rateBps: tax.rateBps,
        baseCents: tax.baseCents,
        amountCents: tax.amountCents,
      })),
    );
  }

  const label = `${dtype.code} ${letter ?? ""} ${formatNumber(pointOfSale, number)}`.replace(/\s+/g, " ").trim();

  if (!input.skipStock && dtype.movesStock && dtype.stockFactor !== 0 && warehouse) {
    for (const line of prepared) {
      if (!line.product?.tracksStock) continue;
      await applyStock(tx, {
        companyId: ctx.companyId,
        productId: line.product.id,
        warehouseId: warehouse.id,
        delta: dtype.stockFactor * line.quantity,
        reason: label,
        documentId: document.id,
        userId: ctx.userId,
        blockNegative: dtype.stockFactor * line.quantity < 0 && company.blockNegativeStock && !input.allowNegativeStock,
      });
    }
  }

  const settlesAccount = input.collectCash || (payment === "cuenta_corriente");
  if (input.kind !== "remito" && dtype.movesAccount && settlesAccount && dtype.accountSide) {
    const amount = totals.totalCents;
    await tx.insert(currentAccountEntries).values({
      companyId: ctx.companyId,
      partyType: input.kind === "compra" ? "supplier" : "customer",
      partyId: party.id,
      documentId: document.id,
      occurredOn: input.issuedOn,
      description: label,
      debitCents: dtype.accountSide === "debit" ? amount : 0,
      creditCents: dtype.accountSide === "credit" ? amount : 0,
    });
  }

  if (dtype.movesCash && (payment === "contado" || input.collectCash) && dtype.cashDirection) {
    const account = await resolveCashAccount(tx, ctx.companyId, input.cashAccountId);
    if (!account) throw new HttpError(400, "No hay una caja activa para imputar el contado");
    await tx.insert(cashMovements).values({
      companyId: ctx.companyId,
      cashAccountId: account.id,
      documentId: document.id,
      direction: dtype.cashDirection,
      amountCents: totals.totalCents,
      description: label,
      occurredOn: input.issuedOn,
      createdBy: ctx.userId,
    });
  }

  await writeAudit(tx, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "documento.emitir",
    entity: "documento",
    entityId: document.id,
    summary: `Emitió ${label} a ${party.name} por ${formatMoney(totals.totalCents)}`,
    metadata: { kind: input.kind, totalCents: totals.totalCents, letter },
  });

  return {
    id: document.id,
    label,
    letter,
    number,
    pointOfSale,
    totalCents: totals.totalCents,
    vatCents: totals.vatCents,
    priceMode,
    status: "confirmado" as const,
    caeStatus,
  };
}

async function loadParty(tx: Tx, companyId: string, kind: DocumentKind, partyId: string): Promise<Party> {
  if (kind === "compra") {
    const [supplier] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, partyId), eq(suppliers.companyId, companyId)));
    if (!supplier || !supplier.active) throw new HttpError(400, "Elegí un proveedor activo");
    if (!isTaxCondition(supplier.taxCondition)) throw new HttpError(400, "El proveedor no tiene condición de IVA");
    return {
      id: supplier.id,
      name: supplier.name,
      cuit: supplier.cuit,
      taxCondition: supplier.taxCondition,
      priceListId: null,
      discountBps: 0,
      perceptionBps: null,
      creditLimitCents: 0,
    };
  }
  const [customer] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, partyId), eq(customers.companyId, companyId)));
  if (!customer || !customer.active) throw new HttpError(400, "Elegí un cliente activo");
  if (!isTaxCondition(customer.taxCondition)) throw new HttpError(400, "El cliente no tiene condición de IVA");
  return {
    id: customer.id,
    name: customer.name,
    cuit: customer.cuit,
    taxCondition: customer.taxCondition,
    priceListId: customer.priceListId,
    discountBps: customer.discountBps,
    perceptionBps: customer.iibbPerceptionBps,
    creditLimitCents: customer.creditLimitCents,
  };
}

async function partyBalance(tx: Tx, companyId: string, partyType: string, partyId: string): Promise<number> {
  const rows = await tx.execute<{ balance: string }>(sql`
    select coalesce(sum(debit_cents - credit_cents), 0)::text as balance
    from current_account_entries
    where company_id = ${companyId}
      and party_type = ${partyType}
      and party_id = ${partyId}
  `);
  return Number(rows[0]?.balance ?? 0);
}

async function resolveWarehouse(tx: Tx, companyId: string, warehouseId?: string | null) {
  if (warehouseId) {
    const [row] = await tx
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, companyId)));
    if (!row) throw new HttpError(400, "Ese depósito no es de esta empresa");
    return row;
  }
  const [row] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.isDefault, true)))
    .limit(1);
  return row ?? null;
}

async function resolveCashAccount(tx: Tx, companyId: string, cashAccountId?: string | null) {
  if (cashAccountId) {
    const [row] = await tx
      .select()
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, cashAccountId), eq(cashAccounts.companyId, companyId), eq(cashAccounts.active, true)));
    return row ?? null;
  }
  const [row] = await tx
    .select()
    .from(cashAccounts)
    .where(and(eq(cashAccounts.companyId, companyId), eq(cashAccounts.active, true), eq(cashAccounts.kind, "caja")))
    .limit(1);
  return row ?? null;
}

export async function getDocument(tx: Tx, companyId: string, id: string) {
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));
  if (!document) return null;
  const [lines, taxes, typeRows, derived, sourceRows] = await Promise.all([
    tx.select().from(documentLines).where(eq(documentLines.documentId, id)).orderBy(asc(documentLines.position)),
    tx.select().from(documentTaxes).where(eq(documentTaxes.documentId, id)),
    tx.select().from(documentTypes).where(eq(documentTypes.id, document.documentTypeId)),
    tx.execute<{ id: string; kind: string; number: number; letter: string | null; point_of_sale: number; code: string; total_cents: string }>(sql`
      select d.id::text, d.kind, d.number, d.letter, d.point_of_sale, dt.code, d.total_cents::text
      from documents d join document_types dt on dt.id = d.document_type_id
      where d.company_id = ${companyId} and d.status = 'confirmado'
        and (
          d.source_document_id = ${id}
          or d.source_document_id in (
            select child.id from documents child
            where child.company_id = ${companyId} and child.source_document_id = ${id}
          )
        )
      order by d.created_at
    `),
    document.sourceDocumentId
      ? tx.execute<{ id: string; kind: string; number: number; letter: string | null; point_of_sale: number; code: string }>(sql`
          select d.id::text, d.kind, d.number, d.letter, d.point_of_sale, dt.code
          from documents d join document_types dt on dt.id = d.document_type_id
          where d.company_id = ${companyId} and d.id = ${document.sourceDocumentId}
        `)
      : Promise.resolve([]),
  ]);
  return {
    ...document,
    lines,
    taxes,
    typeCode: typeRows[0]?.code ?? "",
    typeName: typeRows[0]?.name ?? "",
    sign: typeRows[0]?.sign ?? 1,
    afipCodes: typeRows[0]?.afipCodes ?? {},
    derived,
    sourceDoc: sourceRows[0] ?? null,
  };
}

export async function listDocuments(
  tx: Tx,
  companyId: string,
  filters: { kind: string; q: string; status: string; pageSize: number; offset: number },
) {
  const term = filters.q.replace(/[%_]/g, "");
  const digits = filters.q.replace(/\D/g, "");
  const search = term
    ? or(ilike(documents.partyName, `%${term}%`), digits ? ilike(documents.partyCuit, `%${digits}%`) : undefined)
    : undefined;
  const where = and(
    eq(documents.companyId, companyId),
    eq(documents.kind, filters.kind),
    filters.status ? eq(documents.status, filters.status) : undefined,
    search,
  );
  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: documents.id,
        letter: documents.letter,
        pointOfSale: documents.pointOfSale,
        number: documents.number,
        issuedOn: documents.issuedOn,
        partyName: documents.partyName,
        totalCents: documents.totalCents,
        vatCents: documents.vatCents,
        status: documents.status,
        paymentMethod: documents.paymentMethod,
        typeCode: documentTypes.code,
        sign: documentTypes.sign,
        supplierPos: documents.supplierPos,
        supplierNumber: documents.supplierNumber,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(where)
      .orderBy(desc(documents.issuedOn), desc(documents.number))
      .limit(filters.pageSize)
      .offset(filters.offset),
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(documents)
      .where(where),
  ]);
  return { items: rows, total: Number(totalRows[0]?.total ?? 0) };
}

export async function voidDocument(tx: Tx, ctx: { userId: string; companyId: string }, id: string, reason: string) {
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, ctx.companyId)))
    .for("update");
  if (!document) throw new HttpError(404, "No encontramos el comprobante");
  const [estate] = await tx.execute<{ settled: boolean }>(sql`select estate_document_is_settled(${id}::uuid) as settled`);
  const [construction] = await tx.execute<{ linked: boolean }>(sql`select construction_document_is_linked(${id}::uuid) as linked`);
  if (construction.linked) throw new HttpError(409, "Este comprobante está vinculado a una obra; requiere reversión dentro del circuito de la obra");
  if (estate.settled) throw new HttpError(409, "Este comprobante ya integra una liquidación al propietario; no puede anularse desde Ventas");
  if (document.status === "anulado") throw new HttpError(400, "Ese comprobante ya está anulado");

  const [company] = await tx.select().from(companies).where(eq(companies.id, ctx.companyId));
  const [dtype] = await tx.select().from(documentTypes).where(eq(documentTypes.id, document.documentTypeId));
  const label = `${dtype?.code ?? "DOC"} ${document.letter ?? ""} ${formatNumber(document.pointOfSale, document.number)}`.replace(/\s+/g, " ").trim();

  const movements = await tx.select().from(stockMovements).where(eq(stockMovements.documentId, id));
  for (const movement of movements) {
    await applyStock(tx, {
      companyId: ctx.companyId,
      productId: movement.productId,
      warehouseId: movement.warehouseId,
      delta: -Number(movement.quantity),
      reason: `Anulación ${label}`,
      documentId: id,
      userId: ctx.userId,
      blockNegative: company?.blockNegativeStock ?? false,
    });
  }

  const accounts = await tx.select().from(currentAccountEntries).where(eq(currentAccountEntries.documentId, id));
  if (accounts.length > 0) {
    await tx.insert(currentAccountEntries).values(
      accounts.map((entry) => ({
        companyId: ctx.companyId,
        partyType: entry.partyType,
        partyId: entry.partyId,
        documentId: id,
        occurredOn: new Date().toISOString().slice(0, 10),
        description: `Anulación ${label}`,
        debitCents: entry.creditCents,
        creditCents: entry.debitCents,
      })),
    );
  }

  const cash = await tx.select().from(cashMovements).where(eq(cashMovements.documentId, id));
  if (cash.length > 0) {
    await tx.insert(cashMovements).values(
      cash.map((entry) => ({
        companyId: ctx.companyId,
        cashAccountId: entry.cashAccountId,
        documentId: id,
        direction: entry.direction === "in" ? "out" : "in",
        amountCents: entry.amountCents,
        description: `Anulación ${label}`,
        occurredOn: new Date().toISOString().slice(0, 10),
        createdBy: ctx.userId,
      })),
    );
  }

  await tx
    .update(documents)
    .set({ status: "anulado", voidedAt: new Date(), voidReason: reason.trim() || "Anulado", voidedBy: ctx.userId })
    .where(eq(documents.id, id));

  await writeAudit(tx, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "documento.anular",
    entity: "documento",
    entityId: id,
    summary: `Anuló ${label}. ${reason.trim() || "Sin motivo"}`,
  });

  return { id, status: "anulado" as const };
}
