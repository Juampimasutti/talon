import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission, type AuthContext } from "@/lib/auth/session";
import { moduleEnabled } from "@/lib/auth/permissions";
import { withTenant, type Tx } from "@/lib/db/tenant";
import {
  warehouses,
  currentAccountEntries,
  stockMovements,
} from "@/lib/db/schema";
import { createDocument } from "@/lib/domain/documents";
import { writeAudit } from "@/lib/domain/audit";
import { calcDocument, documentPerceptions } from "@/lib/fiscal/totals";
import { measureCertificate } from "@/lib/construction-rules";
import { addMonths, applyRate } from "@/lib/estate-rules";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(1_000_000_000_000);
const positive = money.refine((v) => v > 0);
const date = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Fecha inválida",
  );
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const vat = z.union([
  z.literal(0),
  z.literal(1050),
  z.literal(2100),
  z.literal(2700),
]);
const workSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    customerId: uuid,
    location: z.string().trim().min(1).max(250),
    responsible: z.string().trim().min(1).max(150),
    startsOn: date,
    endsOn: date,
    repairBps: z.number().int().min(0).max(10000).default(500),
    vatBps: vat.default(2100),
    cacBaseMonth: month.optional(),
    cacBaseIndex: z.number().min(0.000001).max(1e9).optional(),
    cacLagMonths: z.number().int().min(0).max(12).default(0),
  })
  .refine((b) => b.endsOn >= b.startsOn, "Fechas de obra inválidas")
  .refine(
    (b) => !!b.cacBaseMonth === !!b.cacBaseIndex,
    "Cargá mes e índice CAC base juntos",
  );
type Row = Record<string, string | number | boolean | null>;
function also(auth: AuthContext, ...keys: string[]) {
  if (
    keys.some(
      (key) =>
        !auth.permissions.has(key) ||
        !moduleEnabled(auth.company.enabledModules, key.split(".")[0]),
    )
  )
    throw new HttpError(403, "Faltan permisos comerciales para esta operación");
}
async function work(tx: Tx, id: string, lock = true) {
  const [w] = await tx.execute<Row>(
    sql`select * from construction_works where id=${id} ${lock ? sql`for update` : sql``}`,
  );
  if (!w) throw new HttpError(404, "No encontramos la obra");
  return w;
}
async function party(
  tx: Tx,
  id: string,
  side: "customers" | "suppliers" = "customers",
) {
  const rows = await tx.execute(
    sql`select id from ${sql.raw(side)} where id=${id} and active`,
  );
  if (!rows.length)
    throw new HttpError(
      400,
      "La persona no es de esta empresa o está inactiva",
    );
}
async function fiscalWork(tx: Tx, workId: string) {
  const legacy = await tx.execute(
    sql`select 1 from construction_certificates where work_id=${workId} and fiscal_version=1 union all select 1 from construction_advances where work_id=${workId} and invoice_id is null limit 1`,
  );
  if (legacy.length)
    throw new HttpError(
      409,
      "Esta obra contiene pruebas anteriores al criterio fiscal confirmado. Requiere revisión; no se recalcula su historial automáticamente.",
    );
}
async function cash(tx: Tx, id: string) {
  const rows = await tx.execute(
    sql`select id from cash_accounts where id=${id} and active for update`,
  );
  if (!rows.length)
    throw new HttpError(400, "Elegí una caja activa de esta empresa");
}
async function audit(
  tx: Tx,
  auth: AuthContext,
  action: string,
  id: string,
  summary: string,
) {
  await writeAudit(tx, {
    companyId: auth.company.companyId,
    userId: auth.user.id,
    entity: "constructora",
    entityId: id,
    action: `constructora.${action}`,
    summary,
  });
}
async function invoice(
  tx: Tx,
  auth: AuthContext,
  partyId: string,
  amount: number,
  issuedOn: string,
  description: string,
  vatBps: number,
  receipt = false,
  cashId?: string,
) {
  const [type] = await tx.execute<{ id: string }>(
    sql`select id from document_types where code=${receipt ? "REC" : "FAC"} and active`,
  );
  if (!type) throw new HttpError(400, "Falta el tipo de comprobante requerido");
  return createDocument(
    tx,
    { companyId: auth.company.companyId, userId: auth.user.id },
    {
      kind: "venta",
      documentTypeId: type.id,
      partyId,
      issuedOn,
      paymentMethod: receipt ? "contado" : "cuenta_corriente",
      collectCash: receipt,
      cashAccountId: cashId,
      notes: description,
      lines: [
        {
          description,
          quantity: 1,
          unitPriceCents: amount,
          discountBps: 0,
          ivaRateBps: vatBps,
        },
      ],
    },
  );
}

export async function constructora(
  method: string,
  path: string[],
  req: Request,
) {
  const [, resource, id, action] = path;
  const auth = await requirePermission(
    "constructora",
    method === "GET"
      ? "ver"
      : method === "PATCH"
        ? "editar"
        : method === "DELETE"
          ? "anular"
          : "crear",
  );
  const cid = auth.company.companyId;
  if (id && !uuid.safeParse(id).success)
    throw new HttpError(400, "Identificador inválido");
  const selected = new URL(req.url).searchParams.get("workId");
  if (selected && !uuid.safeParse(selected).success)
    throw new HttpError(400, "Obra inválida");
  return withTenant(cid, auth.user.id, async (tx) => {
    if (method === "GET" && resource === "obras")
      return ok({
        items: await tx.execute(
          sql`select w.*,c.name as customer_name,coalesce(b.budget,0)::text as budget_cents,coalesce(b.certified,0)::text as certified_cents from construction_works w join customers c on c.id=w.customer_id left join (select work_id,sum(round(quantity_milli*unit_price_cents/1000.0)) as budget,sum(certified_cents) as certified from construction_items group by work_id)b on b.work_id=w.id order by w.name limit 100`,
        ),
      });
    if (method === "POST" && resource === "obras" && !id) {
      const b = await readBody(req, workSchema);
      await party(tx, b.customerId);
      if (auth.company.taxCondition !== "ri" && b.vatBps !== 0)
        throw new HttpError(
          400,
          "Esta empresa no discrimina IVA; elegí tasa cero",
        );
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: cid, name: `Obra · ${b.name}`, isDefault: false })
        .returning();
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_works(company_id,name,customer_id,location,responsible,starts_on,ends_on,warehouse_id,repair_bps,vat_bps,cac_base_month,cac_base_index,cac_lag_months) values(${cid},${b.name},${b.customerId},${b.location},${b.responsible},${b.startsOn},${b.endsOn},${warehouse.id},${b.repairBps},${b.vatBps},${b.cacBaseMonth ?? null},${b.cacBaseIndex ?? null},${b.cacLagMonths}) returning id`,
      );
      await audit(tx, auth, "obra.crear", row.id, b.name);
      return ok(row);
    }
    if (method === "PATCH" && resource === "obras" && id) {
      const b = await readBody(
        req,
        z.object({
          status: z.enum(["planificada", "activa", "pausada", "finalizada"]),
        }),
      );
      await work(tx, id);
      await tx.execute(
        sql`update construction_works set status=${b.status} where id=${id}`,
      );
      await audit(tx, auth, "obra.estado", id, b.status);
      return ok({ id });
    }
    if (method === "GET" && resource === "items") {
      if (!selected) throw new HttpError(400, "Elegí una obra");
      return ok({
        items: await tx.execute(
          sql`select * from construction_items where work_id=${selected} order by additional,rubro,description`,
        ),
      });
    }
    if (method === "POST" && resource === "items" && !id) {
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          rubro: z.string().trim().min(1).max(120),
          description: z.string().trim().min(1).max(200),
          kind: z.enum(["material", "mano_obra", "subcontrato"]),
          quantity: z.number().positive().max(1e6),
          unitPriceCents: positive,
          global: z.boolean().default(false),
          additional: z.boolean().default(false),
        }),
      );
      await work(tx, b.workId);
      const existing = await tx.execute(
        sql`select id from construction_certificates where work_id=${b.workId} limit 1`,
      );
      if (existing.length && !b.additional)
        throw new HttpError(
          409,
          "Ya hay certificados; el ítem nuevo debe ser un adicional o ampliación",
        );
      if (b.global && b.quantity !== 1)
        throw new HttpError(400, "Un ítem global lleva cantidad 1");
      if (Math.abs(b.quantity * 1000 - Math.round(b.quantity * 1000)) > 1e-6)
        throw new HttpError(400, "La cantidad admite hasta tres decimales");
      const [count] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from construction_items where work_id=${b.workId}`,
      );
      if (count.n >= 500)
        throw new HttpError(400, "La obra admite hasta 500 ítems");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_items(company_id,work_id,rubro,description,kind,quantity_milli,unit_price_cents,global_item,additional) values(${cid},${b.workId},${b.rubro},${b.description},${b.kind},${Math.round(b.quantity * 1000)},${b.unitPriceCents},${b.global},${b.additional}) returning id`,
      );
      await audit(tx, auth, "presupuesto.item", row.id, b.description);
      return ok(row);
    }
    if (
      (method === "PATCH" || method === "DELETE") &&
      resource === "items" &&
      id
    ) {
      const [item] = await tx.execute<Row>(
        sql`select * from construction_items where id=${id} for update`,
      );
      if (!item) throw new HttpError(404, "No encontramos el ítem");
      await work(tx, String(item.work_id));
      const used = await tx.execute(
        sql`select 1 from construction_certificate_lines where item_id=${id} limit 1`,
      );
      if (used.length)
        throw new HttpError(
          409,
          "El ítem ya integra certificados; creá un adicional o ampliación",
        );
      if (method === "DELETE") {
        await tx.execute(sql`delete from construction_items where id=${id}`);
        await audit(
          tx,
          auth,
          "presupuesto.quitar",
          id,
          "Ítem sin certificar eliminado",
        );
        return ok({ id });
      }
      const b = await readBody(
        req,
        z.object({
          rubro: z.string().trim().min(1).max(120),
          description: z.string().trim().min(1).max(200),
          quantity: z.number().positive().max(1e6),
          unitPriceCents: positive,
        }),
      );
      if (item.global_item && b.quantity !== 1)
        throw new HttpError(400, "Un ítem global lleva cantidad 1");
      if (Math.abs(b.quantity * 1000 - Math.round(b.quantity * 1000)) > 1e-6)
        throw new HttpError(400, "La cantidad admite tres decimales");
      await tx.execute(
        sql`update construction_items set rubro=${b.rubro},description=${b.description},quantity_milli=${Math.round(b.quantity * 1000)},unit_price_cents=${b.unitPriceCents} where id=${id}`,
      );
      await audit(tx, auth, "presupuesto.editar", id, b.description);
      return ok({ id });
    }
    if (method === "GET" && resource === "certificados" && id) {
      const [certificate] = await tx.execute<Row>(
        sql`select c.*,w.name as work_name,w.location,w.customer_id,u.name as customer_name from construction_certificates c join construction_works w on w.id=c.work_id join customers u on u.id=w.customer_id where c.id=${id}`,
      );
      if (!certificate)
        throw new HttpError(404, "No encontramos el certificado");
      const lines = await tx.execute(
        sql`select l.*,i.rubro,i.description,i.global_item,i.unit_price_cents from construction_certificate_lines l join construction_items i on i.id=l.item_id where l.certificate_id=${id} order by i.rubro,i.description`,
      );
      return ok({ certificate, lines });
    }
    if (method === "GET" && resource === "certificados")
      return ok({
        items: await tx.execute(
          sql`select c.*,w.name as work_name,coalesce(p.paid,0)::text as paid_cents,exists(select 1 from construction_releases r where r.work_id=c.work_id) as repair_released from construction_certificates c join construction_works w on w.id=c.work_id left join(select certificate_id,sum(amount_cents) as paid from construction_collections group by certificate_id)p on p.certificate_id=c.id where (${selected}::uuid is null or c.work_id=${selected}::uuid) order by c.period desc limit 100`,
        ),
      });
    if (
      method === "POST" &&
      (resource === "certificados" || resource === "previsualizacion") &&
      !id
    ) {
      also(auth, "ventas.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          period: month,
          issuedOn: date,
          cacMonth: month.optional(),
          cacIndex: z.number().min(0.000001).max(1e9).optional(),
          cacSource: z.string().max(250).default(""),
          notes: z.string().max(500).default(""),
          items: z
            .array(
              z.object({
                itemId: uuid,
                cumulativeQuantity: z.number().min(0).max(1e6).optional(),
                cumulativeBps: z.number().int().min(0).max(10000).optional(),
              }),
            )
            .min(1)
            .max(500),
        }),
      );
      const w = await work(tx, b.workId);
      await fiscalWork(tx, b.workId);
      if (
        b.period < String(w.starts_on).slice(0, 7) ||
        b.period > String(w.ends_on).slice(0, 7)
      )
        throw new HttpError(400, "El período no pertenece a la obra");
      if (w.status !== "activa")
        throw new HttpError(409, "La obra no está activa");
      const items = await tx.execute<Row>(
        sql`select * from construction_items where work_id=${b.workId} order by id for update`,
      );
      const measurements = new Map(b.items.map((item) => [item.itemId, item]));
      if (
        measurements.size !== b.items.length ||
        b.items.some((item) => !items.some((known) => known.id === item.itemId))
      )
        throw new HttpError(400, "Hay ítems repetidos o de otra obra");
      const [advances] = await tx.execute<{ amount: string }>(
        sql`select coalesce(sum(amount_cents),0)::text as amount from construction_advances where work_id=${b.workId}`,
      );
      const [returned] = await tx.execute<{
        amount: string;
        period: string | null;
      }>(
        sql`select coalesce(sum(advance_returned_cents),0)::text as amount,max(period) as period from construction_certificates where work_id=${b.workId}`,
      );
      if (returned.period && b.period <= returned.period)
        throw new HttpError(
          409,
          "El período debe ser posterior al último certificado",
        );
      let baseIndex = 1000000;
      let currentIndex = 1000000;
      if (w.cac_base_index !== null) {
        const expected = addMonths(
          `${b.period}-01`,
          -Number(w.cac_lag_months),
        ).slice(0, 7);
        if (!b.cacIndex || b.cacMonth !== expected || !b.cacSource.trim())
          throw new HttpError(
            400,
            `Cargá el índice CAC de ${expected} y su fuente`,
          );
        baseIndex = Math.round(Number(w.cac_base_index) * 1e6);
        currentIndex = Math.round(b.cacIndex * 1e6);
      } else if (b.cacIndex)
        throw new HttpError(400, "La obra no tiene un ajuste CAC pactado");
      let result;
      try {
        result = measureCertificate(
          items.map((item) => {
            const value = measurements.get(String(item.id));
            if (
              value?.cumulativeQuantity !== undefined &&
              Math.abs(
                value.cumulativeQuantity * 1000 -
                  Math.round(value.cumulativeQuantity * 1000),
              ) > 1e-6
            )
              throw Error("La cantidad admite tres decimales");
            if (
              value?.cumulativeQuantity !== undefined &&
              Math.round(value.cumulativeQuantity * 1000) <
                Number(item.certified_quantity_milli)
            )
              throw Error("La cantidad acumulada no puede retroceder");
            if (
              value?.cumulativeBps !== undefined &&
              value.cumulativeBps < Number(item.certified_bps)
            )
              throw Error("El avance del ítem global no puede retroceder");
            return {
              id: String(item.id),
              quantityMilli: Number(item.quantity_milli),
              unitPriceCents: Number(item.unit_price_cents),
              global: !!item.global_item,
              previousCents: Number(item.certified_cents),
              cumulativeQuantityMilli:
                value?.cumulativeQuantity === undefined
                  ? Number(item.certified_quantity_milli)
                  : Math.round(value.cumulativeQuantity * 1000),
              cumulativeBps: value?.cumulativeBps ?? Number(item.certified_bps),
            };
          }),
          {
            indexBaseMillion: baseIndex,
            indexPeriodMillion: currentIndex,
            advanceCents: Number(advances.amount),
            recoveredAdvanceCents: Number(returned.amount),
            repairBps: Number(w.repair_bps),
            vatBps: Number(w.vat_bps),
          },
        );
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : "Certificado inválido",
        );
      }
      const [receiver] = await tx.execute<{
        iibb_perception_bps: number | null;
      }>(
        sql`select iibb_perception_bps from customers where id=${w.customer_id}`,
      );
      const fiscal = calcDocument({
        priceMode: auth.company.taxCondition === "ri" ? "net" : "sin_iva",
        perceptions: documentPerceptions({
          kind: "venta",
          partyBps: receiver.iibb_perception_bps,
        }),
        lines: [
          {
            quantity: 1,
            unitPriceCents: result.taxBaseCents,
            discountBps: 0,
            ivaRateBps: Number(w.vat_bps),
            taxTreatment: "gravado",
          },
        ],
      });
      if (resource === "previsualizacion")
        return ok({
          ...result,
          vatCents: fiscal.vatCents,
          totalCents: fiscal.totalCents,
          perceptionsCents: fiscal.perceptionsCents,
        });
      const document = await invoice(
        tx,
        auth,
        String(w.customer_id),
        result.taxBaseCents,
        b.issuedOn,
        `Certificado ${w.name} · ${b.period}. Básico ${result.periodBaseCents}; ajuste CAC ${result.adjustmentCents}; devolución anticipo ${result.advanceReturnedCents}; reparo ${result.repairCents} (importes en centavos). ${b.notes}`,
        Number(w.vat_bps),
      );
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_certificates(company_id,work_id,period,issued_on,invoice_id,base_cents,adjustment_cents,advance_returned_cents,repair_cents,tax_base_cents,vat_cents,total_cents,progress_bps,cac_month,cac_index,cac_source,notes) values(${cid},${b.workId},${b.period},${b.issuedOn},${document.id},${result.periodBaseCents},${result.adjustmentCents},${result.advanceReturnedCents},${result.repairCents},${result.taxBaseCents},${document.vatCents},${document.totalCents},${result.progressBps},${b.cacMonth ?? null},${b.cacIndex ?? null},${b.cacSource},${b.notes}) returning id`,
      );
      const lines = result.lines.map((line) => {
        const item = items.find((i) => i.id === line.id)!;
        const v = measurements.get(line.id);
        return {
          item_id: line.id,
          cumulative_cents: line.cumulativeCents,
          period_cents: line.periodCents,
          cumulative_quantity_milli:
            v?.cumulativeQuantity === undefined
              ? Number(item.certified_quantity_milli)
              : Math.round(v.cumulativeQuantity * 1000),
          cumulative_bps: v?.cumulativeBps ?? Number(item.certified_bps),
        };
      });
      const json = JSON.stringify(lines);
      await tx.execute(
        sql`insert into construction_certificate_lines(company_id,certificate_id,item_id,cumulative_cents,period_cents,cumulative_quantity_milli,cumulative_bps) select ${cid}::uuid,${row.id}::uuid,item_id,cumulative_cents,period_cents,cumulative_quantity_milli,cumulative_bps from jsonb_to_recordset(${json}::jsonb) as l(item_id uuid,cumulative_cents bigint,period_cents bigint,cumulative_quantity_milli bigint,cumulative_bps int)`,
      );
      await tx.execute(
        sql`update construction_items i set certified_cents=l.cumulative_cents,certified_quantity_milli=l.cumulative_quantity_milli,certified_bps=l.cumulative_bps from jsonb_to_recordset(${json}::jsonb) as l(item_id uuid,cumulative_cents bigint,cumulative_quantity_milli bigint,cumulative_bps int) where i.id=l.item_id`,
      );
      await audit(
        tx,
        auth,
        "certificado.emitir",
        row.id,
        `Certificado ${b.period}, por cantidades acumuladas`,
      );
      return ok({
        id: row.id,
        documentId: document.id,
        ...result,
        totalCents: document.totalCents,
      });
    }
    if (method === "POST" && resource === "anticipos" && !id) {
      also(auth, "ventas.crear", "caja.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          amountCents: positive,
          cashAccountId: uuid,
          occurredOn: date,
        }),
      );
      const w = await work(tx, b.workId);
      await fiscalWork(tx, b.workId);
      await cash(tx, b.cashAccountId);
      const existing = await tx.execute(
        sql`select 1 from construction_certificates where work_id=${b.workId} limit 1`,
      );
      if (existing.length)
        throw new HttpError(
          409,
          "El anticipo se registra antes del primer certificado",
        );
      const advanceInvoice = await invoice(
        tx,
        auth,
        String(w.customer_id),
        b.amountCents,
        b.occurredOn,
        `Anticipo neto de obra ${w.name}`,
        Number(w.vat_bps),
      );
      const receipt = await invoice(
        tx,
        auth,
        String(w.customer_id),
        advanceInvoice.totalCents,
        b.occurredOn,
        `Cancelación factura de anticipo ${advanceInvoice.id}`,
        0,
        true,
        b.cashAccountId,
      );
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_advances(company_id,work_id,amount_cents,receipt_id,invoice_id) values(${cid},${b.workId},${b.amountCents},${receipt.id},${advanceInvoice.id}) returning id`,
      );
      await audit(
        tx,
        auth,
        "anticipo",
        row.id,
        "Anticipo en caja, reservado para devolución proporcional",
      );
      return ok({
        id: row.id,
        documentId: receipt.id,
        invoiceId: advanceInvoice.id,
        totalCents: advanceInvoice.totalCents,
      });
    }
    if (
      method === "POST" &&
      resource === "certificados" &&
      id &&
      action === "cobrar"
    ) {
      also(auth, "ventas.crear", "caja.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          amountCents: positive,
          cashAccountId: uuid,
          occurredOn: date,
        }),
      );
      await cash(tx, b.cashAccountId);
      const [c] = await tx.execute<Row>(
        sql`select c.*,w.customer_id from construction_certificates c join construction_works w on w.id=c.work_id where c.id=${id} for update of c`,
      );
      if (!c) throw new HttpError(404, "No encontramos el certificado");
      await fiscalWork(tx, String(c.work_id));
      const [paid] = await tx.execute<{ amount: string }>(
        sql`select coalesce(sum(amount_cents),0)::text as amount from construction_collections where certificate_id=${id}`,
      );
      const released = await tx.execute(
        sql`select 1 from construction_releases where work_id=${c.work_id}`,
      );
      const collectible =
        Number(c.total_cents) - (released.length ? 0 : Number(c.repair_cents));
      if (Number(paid.amount) + b.amountCents > collectible)
        throw new HttpError(409, "El cobro supera el saldo del certificado");
      const receipt = await invoice(
        tx,
        auth,
        String(c.customer_id),
        b.amountCents,
        b.occurredOn,
        `Cobro certificado ${id}`,
        0,
        true,
        b.cashAccountId,
      );
      await tx.execute(
        sql`insert into construction_collections(company_id,certificate_id,amount_cents,receipt_id) values(${cid},${id},${b.amountCents},${receipt.id})`,
      );
      await audit(
        tx,
        auth,
        "certificado.cobrar",
        id,
        "Cobro del neto facturado",
      );
      return ok({ documentId: receipt.id });
    }
    if (
      method === "POST" &&
      resource === "obras" &&
      id &&
      action === "liberar-reparo"
    ) {
      also(auth, "ventas.crear", "cuentas_corrientes.crear");
      const b = await readBody(req, z.object({ occurredOn: date }));
      const w = await work(tx, id);
      await fiscalWork(tx, id);
      if (w.status !== "finalizada")
        throw new HttpError(409, "El reparo se libera al finalizar la obra");
      const prior = await tx.execute(
        sql`select 1 from construction_releases where work_id=${id}`,
      );
      if (prior.length) throw new HttpError(409, "El fondo ya fue liberado");
      const [total] = await tx.execute<{ amount: string }>(
        sql`select coalesce(sum(repair_cents),0)::text as amount from construction_certificates where work_id=${id}`,
      );
      const amount = Number(total.amount);
      if (amount <= 0)
        throw new HttpError(400, "No hay fondo de reparo pendiente");
      await tx.execute(
        sql`insert into construction_releases(company_id,work_id,amount_cents) values(${cid},${id},${amount})`,
      );
      await audit(
        tx,
        auth,
        "reparo.liberar",
        id,
        `Fondo de reparo liberado ${b.occurredOn} para cobro, sin nueva factura ni IVA`,
      );
      return ok({ amountCents: amount });
    }
    if (method === "GET" && resource === "costos")
      return ok({
        items: await tx.execute(
          sql`select c.*,w.name as work_name,d.status as purchase_status from construction_costs c join construction_works w on w.id=c.work_id left join documents d on d.id=c.purchase_id where (${selected}::uuid is null or c.work_id=${selected}::uuid) order by c.occurred_on desc limit 100`,
        ),
      });
    if (method === "POST" && resource === "costos" && !id) {
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          kind: z.enum(["material", "mano_obra", "subcontrato", "gasto"]),
          description: z.string().trim().min(1).max(250),
          amountCents: positive,
          occurredOn: date,
          purchaseId: uuid.optional(),
        }),
      );
      await work(tx, b.workId);
      if (b.purchaseId) {
        also(auth, "compras.ver");
        const [purchase] = await tx.execute<Row>(
          sql`select * from documents where id=${b.purchaseId} and kind='compra' and status='confirmado' for update`,
        );
        if (!purchase)
          throw new HttpError(
            400,
            "Elegí una compra confirmada de esta empresa",
          );
        const [used] = await tx.execute<{ amount: string }>(
          sql`select coalesce(sum(amount_cents),0)::text as amount from construction_costs where purchase_id=${b.purchaseId}`,
        );
        if (Number(used.amount) + b.amountCents > Number(purchase.total_cents))
          throw new HttpError(
            409,
            "Las imputaciones superan el importe de la compra",
          );
      }
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_costs(company_id,work_id,kind,description,amount_cents,occurred_on,purchase_id) values(${cid},${b.workId},${b.kind},${b.description},${b.amountCents},${b.occurredOn},${b.purchaseId ?? null}) returning id`,
      );
      await audit(
        tx,
        auth,
        "costo",
        row.id,
        "Costo imputado sin duplicar comprobantes ni movimientos de caja",
      );
      return ok(row);
    }
    if (method === "GET" && resource === "subcontratos")
      return ok({
        items: await tx.execute(
          sql`select s.*,p.name as supplier_name,coalesce(c.certified,0)::text as certified_cents,coalesce(c.retained,0)::text as retained_cents from construction_subcontracts s join suppliers p on p.id=s.supplier_id left join(select subcontract_id,sum(amount_cents) as certified,sum(retained_cents) as retained from construction_subcertificates group by subcontract_id)c on c.subcontract_id=s.id where (${selected}::uuid is null or s.work_id=${selected}::uuid) order by s.description limit 100`,
        ),
      });
    if (method === "POST" && resource === "subcontratos" && !id) {
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          supplierId: uuid,
          description: z.string().trim().min(1).max(250),
          amountCents: positive,
          retentionBps: z.number().int().min(0).max(10000).default(0),
        }),
      );
      await work(tx, b.workId);
      await party(tx, b.supplierId, "suppliers");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_subcontracts(company_id,work_id,supplier_id,description,amount_cents,retention_bps) values(${cid},${b.workId},${b.supplierId},${b.description},${b.amountCents},${b.retentionBps}) returning id`,
      );
      await audit(tx, auth, "subcontrato", row.id, b.description);
      return ok(row);
    }
    if (
      method === "POST" &&
      resource === "subcontratos" &&
      id &&
      action === "certificar"
    ) {
      const b = await readBody(
        req,
        z.object({ period: month, amountCents: positive, occurredOn: date }),
      );
      const [s] = await tx.execute<Row>(
        sql`select * from construction_subcontracts where id=${id} for update`,
      );
      if (!s) throw new HttpError(404, "No encontramos el subcontrato");
      const [used] = await tx.execute<{ amount: string }>(
        sql`select coalesce(sum(amount_cents),0)::text as amount from construction_subcertificates where subcontract_id=${id}`,
      );
      if (Number(used.amount) + b.amountCents > Number(s.amount_cents))
        throw new HttpError(
          409,
          "El certificado supera el subcontrato; primero ampliá el contrato",
        );
      const retained = applyRate(b.amountCents, Number(s.retention_bps));
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_subcertificates(company_id,subcontract_id,period,amount_cents,retained_cents) values(${cid},${id},${b.period},${b.amountCents},${retained}) returning id`,
      );
      await tx.execute(
        sql`insert into construction_costs(company_id,work_id,kind,description,amount_cents,occurred_on,subcertificate_id) values(${cid},${s.work_id},'subcontrato',${s.description},${b.amountCents},${b.occurredOn},${row.id})`,
      );
      await audit(
        tx,
        auth,
        "subcontrato.certificar",
        row.id,
        "Certificado registrado como costo; no mueve caja ni reemplaza la factura del proveedor",
      );
      return ok({ id: row.id, retainedCents: retained });
    }
    if (method === "GET" && resource === "acopio")
      return ok({
        items: await tx.execute(
          sql`select l.quantity,p.sku,p.name,w.name as work_name from stock_levels l join construction_works w on w.warehouse_id=l.warehouse_id join products p on p.id=l.product_id where (${selected}::uuid is null or w.id=${selected}::uuid) order by w.name,p.sku limit 100`,
        ),
      });
    if (method === "POST" && resource === "acopio" && !id) {
      also(auth, "stock.crear", "remitos.crear");
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          productId: uuid,
          fromWarehouseId: uuid,
          quantity: z.number().positive().max(1e6),
          occurredOn: date,
        }),
      );
      const w = await work(tx, b.workId);
      await fiscalWork(tx, b.workId);
      if (Math.abs(b.quantity * 1000 - Math.round(b.quantity * 1000)) > 1e-6)
        throw new HttpError(400, "La cantidad admite tres decimales");
      if (w.warehouse_id === b.fromWarehouseId)
        throw new HttpError(
          400,
          "Elegí un depósito de origen diferente de la obra",
        );
      const [product] = await tx.execute<{
        tracks_stock: boolean;
        cost_cents: string;
      }>(
        sql`select tracks_stock,cost_cents::text from products where id=${b.productId} and active`,
      );
      if (!product || !product.tracks_stock)
        throw new HttpError(400, "Elegí un artículo con stock");
      const [type] = await tx.execute<{ id: string }>(
        sql`select id from document_types where code='REM' and active`,
      );
      if (!type) throw new HttpError(400, "Falta el comprobante de remito");
      const document = await createDocument(
        tx,
        { companyId: cid, userId: auth.user.id },
        {
          kind: "remito",
          documentTypeId: type.id,
          partyId: String(w.customer_id),
          issuedOn: b.occurredOn,
          warehouseId: b.fromWarehouseId,
          notes: `Transferencia a obra ${w.name}`,
          lines: [
            {
              productId: b.productId,
              quantity: b.quantity,
              unitPriceCents: Number(product.cost_cents),
            },
          ],
        },
      );
      await tx.execute(
        sql`insert into stock_levels(company_id,product_id,warehouse_id,quantity) values(${cid},${b.productId},${w.warehouse_id},${b.quantity.toFixed(3)}) on conflict(product_id,warehouse_id) do update set quantity=stock_levels.quantity+excluded.quantity`,
      );
      await tx.insert(stockMovements).values({
        companyId: cid,
        productId: b.productId,
        warehouseId: String(w.warehouse_id),
        quantity: b.quantity,
        reason: `Recepción en obra ${w.name}`,
        documentId: document.id,
        createdBy: auth.user.id,
      });
      await tx.execute(
        sql`insert into construction_transfers(company_id,work_id,document_id) values(${cid},${b.workId},${document.id})`,
      );
      await audit(
        tx,
        auth,
        "acopio",
        document.id,
        "Remito de transferencia entre depósitos, sin duplicar existencias",
      );
      return ok({ documentId: document.id });
    }
    if (method === "GET" && resource === "unidades")
      return ok({
        items: await tx.execute(
          sql`select u.*,c.id as contract_id,c.buyer_id,p.name as buyer_name from construction_units u left join construction_unit_contracts c on c.unit_id=u.id left join customers p on p.id=c.buyer_id where (${selected}::uuid is null or u.work_id=${selected}::uuid) order by u.name limit 100`,
        ),
      });
    if (method === "POST" && resource === "unidades" && !id) {
      const b = await readBody(
        req,
        z.object({
          workId: uuid,
          name: z.string().trim().min(1).max(150),
          priceCents: positive,
        }),
      );
      await work(tx, b.workId);
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into construction_units(company_id,work_id,name,price_cents) values(${cid},${b.workId},${b.name},${b.priceCents}) returning id`,
      );
      await audit(tx, auth, "unidad", row.id, b.name);
      return ok(row);
    }
    if (
      method === "POST" &&
      resource === "unidades" &&
      id &&
      action === "vender"
    ) {
      also(auth, "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          buyerId: uuid,
          priceCents: positive,
          installments: z.number().int().min(1).max(120),
          firstDueOn: date,
          adjustmentMethod: z.enum(["manual", "fijo", "CAC", "sin_ajuste"]),
          fixedBps: z.number().int().min(0).max(100000).default(0),
        }),
      );
      await party(tx, b.buyerId);
      const [u] = await tx.execute<Row>(
        sql`select * from construction_units where id=${id} for update`,
      );
      if (!u || u.status !== "disponible")
        throw new HttpError(409, "La unidad no está disponible");
      if (b.priceCents < b.installments)
        throw new HttpError(
          400,
          "El precio no alcanza para distribuir las cuotas",
        );
      const [contract] = await tx.execute<{ id: string }>(
        sql`insert into construction_unit_contracts(company_id,unit_id,buyer_id,price_cents,adjustment_method,fixed_bps) values(${cid},${id},${b.buyerId},${b.priceCents},${b.adjustmentMethod},${b.fixedBps}) returning id`,
      );
      const base = Math.floor(b.priceCents / b.installments);
      const installments = Array.from({ length: b.installments }, (_, i) => ({
        number: i + 1,
        due_on: addMonths(b.firstDueOn, i),
        amount_cents:
          base +
          (i === b.installments - 1 ? b.priceCents - base * b.installments : 0),
      }));
      await tx.execute(
        sql`insert into construction_installments(company_id,contract_id,number,due_on,amount_cents) select ${cid}::uuid,${contract.id}::uuid,number,due_on,amount_cents from jsonb_to_recordset(${JSON.stringify(installments)}::jsonb) as x(number int,due_on date,amount_cents bigint)`,
      );
      await tx.insert(currentAccountEntries).values(
        installments.map((item) => ({
          companyId: cid,
          partyType: "customer",
          partyId: b.buyerId,
          occurredOn: item.due_on,
          description: `Cuota ${item.number} · unidad ${u.name} · ${contract.id}`,
          debitCents: item.amount_cents,
        })),
      );
      await tx.execute(
        sql`update construction_units set status='vendida' where id=${id}`,
      );
      await audit(
        tx,
        auth,
        "unidad.vender",
        id,
        "Plan contractual de cuotas en cuenta corriente; no emite factura fiscal de la unidad",
      );
      return ok({ id: contract.id });
    }
    if (method === "GET" && resource === "cuotas")
      return ok({
        items: await tx.execute(
          sql`select i.*,u.name as unit_name,u.work_id,p.name as buyer_name from construction_installments i join construction_unit_contracts c on c.id=i.contract_id join construction_units u on u.id=c.unit_id join customers p on p.id=c.buyer_id where (${selected}::uuid is null or u.work_id=${selected}::uuid) order by i.due_on limit 100`,
        ),
      });
    if (
      method === "POST" &&
      resource === "cuotas" &&
      id &&
      action === "ajustar"
    ) {
      also(auth, "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          coefficient: z.number().positive().max(1000).optional(),
          newAmountCents: positive.optional(),
          source: z.string().trim().min(1).max(250),
          occurredOn: date,
        }),
      );
      const [q] = await tx.execute<Row>(
        sql`select i.*,c.buyer_id,c.adjustment_method,c.fixed_bps from construction_installments i join construction_unit_contracts c on c.id=i.contract_id where i.id=${id} for update of i`,
      );
      if (!q || q.adjustment_method === "sin_ajuste")
        throw new HttpError(400, "La cuota no admite ajuste");
      const pending = Number(q.amount_cents) - Number(q.paid_cents);
      if (pending <= 0) throw new HttpError(409, "La cuota ya fue pagada");
      const nextPending =
        q.adjustment_method === "fijo"
          ? pending + applyRate(pending, Number(q.fixed_bps))
          : q.adjustment_method === "manual"
            ? b.newAmountCents
            : b.coefficient
              ? Math.round(pending * b.coefficient)
              : undefined;
      if (
        !nextPending ||
        !Number.isSafeInteger(nextPending) ||
        nextPending > 1e12
      )
        throw new HttpError(
          400,
          "Indicá el nuevo saldo o coeficiente según el contrato",
        );
      const delta = nextPending - pending;
      await tx.execute(
        sql`insert into construction_installment_adjustments(company_id,installment_id,effective_month,old_cents,new_cents,source) values(${cid},${id},${b.occurredOn.slice(0, 7)},${Number(q.amount_cents)},${Number(q.paid_cents) + nextPending},${b.source})`,
      );
      await tx.execute(
        sql`update construction_installments set amount_cents=${Number(q.paid_cents) + nextPending},index_value=${b.coefficient ?? null},index_source=${b.source} where id=${id}`,
      );
      if (delta !== 0)
        await tx.insert(currentAccountEntries).values({
          companyId: cid,
          partyType: "customer",
          partyId: String(q.buyer_id),
          occurredOn: b.occurredOn,
          description: `Ajuste cuota ${q.number} · ${id} · ${b.source}`,
          debitCents: Math.max(0, delta),
          creditCents: Math.max(0, -delta),
        });
      await audit(tx, auth, "cuota.ajustar", id, b.source);
      return ok({ id, amountCents: Number(q.paid_cents) + nextPending });
    }
    if (
      method === "POST" &&
      resource === "cuotas" &&
      id &&
      action === "cobrar"
    ) {
      also(auth, "ventas.crear", "caja.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          amountCents: positive,
          cashAccountId: uuid,
          occurredOn: date,
        }),
      );
      await cash(tx, b.cashAccountId);
      const [q] = await tx.execute<Row>(
        sql`select i.*,c.buyer_id from construction_installments i join construction_unit_contracts c on c.id=i.contract_id where i.id=${id} for update of i`,
      );
      if (!q || b.amountCents > Number(q.amount_cents) - Number(q.paid_cents))
        throw new HttpError(409, "El cobro supera el saldo de la cuota");
      const receipt = await invoice(
        tx,
        auth,
        String(q.buyer_id),
        b.amountCents,
        b.occurredOn,
        `Recibo cuota ${q.number} · ${q.contract_id}`,
        0,
        true,
        b.cashAccountId,
      );
      await tx.execute(
        sql`update construction_installments set paid_cents=paid_cents+${b.amountCents} where id=${id}`,
      );
      await tx.execute(
        sql`insert into construction_installment_receipts(company_id,installment_id,receipt_id,amount_cents) values(${cid},${id},${receipt.id},${b.amountCents})`,
      );
      await audit(tx, auth, "cuota.cobrar", id, "Cobro de cuota");
      return ok({ documentId: receipt.id });
    }
    if (method === "GET" && resource === "informes") {
      const [works, costs, certificates, advances, units] = await Promise.all([
        tx.execute(
          sql`select w.id,w.name,w.status,coalesce(b.budget,0)::text as budget_cents,coalesce(b.certified,0)::text as certified_cents from construction_works w left join(select work_id,sum(round(quantity_milli*unit_price_cents/1000.0)) as budget,sum(certified_cents) as certified from construction_items group by work_id)b on b.work_id=w.id where (${selected}::uuid is null or w.id=${selected}::uuid)`,
        ),
        tx.execute(
          sql`select c.work_id,c.kind,sum(c.amount_cents)::text as amount_cents from construction_costs c left join documents d on d.id=c.purchase_id where (c.purchase_id is null or d.status='confirmado') and (${selected}::uuid is null or work_id=${selected}::uuid) group by c.work_id,c.kind`,
        ),
        tx.execute(
          sql`select c.work_id,sum(c.base_cents+c.adjustment_cents)::text as earned_cents,sum(c.tax_base_cents)::text as invoiced_net_cents,sum(c.total_cents)::text as invoiced_cents,sum(c.repair_cents)::text as retained_cents,coalesce(sum(p.paid),0)::text as paid_cents from construction_certificates c left join(select certificate_id,sum(amount_cents) as paid from construction_collections group by certificate_id)p on p.certificate_id=c.id where (${selected}::uuid is null or c.work_id=${selected}::uuid) group by c.work_id`,
        ),
        tx.execute(
          sql`select w.id,coalesce(a.amount,0)::text as advance_cents,coalesce(c.recovered,0)::text as recovered_cents,r.id as repair_release_id from construction_works w left join(select work_id,sum(amount_cents) as amount from construction_advances group by work_id)a on a.work_id=w.id left join(select work_id,sum(advance_returned_cents) as recovered from construction_certificates group by work_id)c on c.work_id=w.id left join construction_releases r on r.work_id=w.id where (${selected}::uuid is null or w.id=${selected}::uuid)`,
        ),
        tx.execute(
          sql`select u.work_id,sum(i.amount_cents-i.paid_cents)::text as pending_cents,coalesce(sum(i.amount_cents-i.paid_cents) filter(where i.due_on<current_date),0)::text as overdue_cents from construction_installments i join construction_unit_contracts c on c.id=i.contract_id join construction_units u on u.id=c.unit_id where (${selected}::uuid is null or u.work_id=${selected}::uuid) group by u.work_id`,
        ),
      ]);
      return ok({ works, costs, certificates, advances, units });
    }
    throw new HttpError(404, "No existe esa ruta de constructora");
  });
}
