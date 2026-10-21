import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission, type AuthContext } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { cashMovements, currentAccountEntries } from "@/lib/db/schema";
import { createDocument } from "@/lib/domain/documents";
import { writeAudit } from "@/lib/domain/audit";
import {
  addMonths,
  applyRate,
  leasePenalty,
  settlementAmounts,
} from "@/lib/estate-rules";
import { HttpError, ok, pageParams } from "@/lib/http";
import { readBody } from "@/lib/validation";
import { moduleEnabled } from "@/lib/auth/permissions";
import { cashOutAllowed } from "@/lib/guards";

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(1_000_000_000_000);
const date = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Fecha inválida",
  );
const vat = z.union([
  z.literal(0),
  z.literal(1050),
  z.literal(2100),
  z.literal(2700),
]);
const propertySchema = z.object({
  address: z.string().trim().min(1).max(250),
  kind: z.enum(["casa", "depto", "local", "lote"]),
  ownerCustomerId: uuid,
  ownerSupplierId: uuid,
  status: z
    .enum(["disponible", "alquilada", "vendida", "reservada"])
    .default("disponible"),
  notes: z.string().max(2000).default(""),
});
const contractSchema = z
  .object({
    propertyId: uuid,
    tenantId: uuid,
    startsOn: date,
    endsOn: date,
    initialRentCents: money.refine((value) => value > 0),
    adjustmentMethod: z.enum(["manual", "fijo", "ICL", "IPC"]),
    adjustmentMonths: z.number().int().min(1).max(36),
    fixedAdjustmentBps: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .nullable()
      .default(null),
    commissionBps: z.number().int().min(0).max(10000).default(0),
    commissionVatBps: vat.default(0),
    lateDailyBps: z.number().int().min(0).max(10000).default(0),
    graceDays: z.number().int().min(0).max(60).default(0),
    depositCents: money.default(0),
    dueDay: z.number().int().min(1).max(28),
    guarantors: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  })
  .refine(
    (value) => value.endsOn >= value.startsOn,
    "El contrato termina antes de comenzar",
  )
  .refine(
    (value) =>
      value.adjustmentMethod !== "fijo" || value.fixedAdjustmentBps !== null,
    "Indicá el porcentaje de ajuste fijo",
  );

type Row = Record<string, string | number | null>;
async function customer(tx: Tx, id: string) {
  const result = await tx.execute(
    sql`select id from customers where id=${id} and active`,
  );
  if (!result.length)
    throw new HttpError(400, "Elegí un cliente activo de esta empresa");
}
async function supplier(tx: Tx, id: string) {
  const result = await tx.execute(
    sql`select id from suppliers where id=${id} and active`,
  );
  if (!result.length)
    throw new HttpError(400, "Elegí un proveedor activo de esta empresa");
}
async function cash(tx: Tx, id: string) {
  const result = await tx.execute(
    sql`select id from cash_accounts where id=${id} and active for update`,
  );
  if (!result.length)
    throw new HttpError(400, "Elegí una caja activa de esta empresa");
}
async function doc(
  tx: Tx,
  auth: AuthContext,
  code: string,
  partyId: string,
  amount: number,
  occurredOn: string,
  options: {
    cashAccountId?: string;
    description: string;
    vatBps?: number;
    receipt?: boolean;
  },
) {
  const [type] = await tx.execute<{ id: string }>(
    sql`select id from document_types where code=${code} and active`,
  );
  if (!type) throw new HttpError(400, `Falta el comprobante ${code}`);
  return createDocument(
    tx,
    { userId: auth.user.id, companyId: auth.company.companyId },
    {
      kind: "venta",
      documentTypeId: type.id,
      partyId,
      issuedOn: occurredOn,
      paymentMethod: options.receipt ? "contado" : "cuenta_corriente",
      collectCash: options.receipt,
      cashAccountId: options.cashAccountId,
      notes: options.description,
      lines: [
        {
          description: options.description,
          quantity: 1,
          discountBps: 0,
          unitPriceCents: amount,
          ivaRateBps: options.vatBps ?? 0,
        },
      ],
    },
  );
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
    action: `inmobiliaria.${action}`,
    entity: "inmobiliaria",
    entityId: id,
    summary,
  });
}
function also(auth: AuthContext, ...permissions: string[]) {
  if (
    permissions.some(
      (key) =>
        !auth.permissions.has(key) ||
        !moduleEnabled(auth.company.enabledModules, key.split(".")[0]),
    )
  )
    throw new HttpError(
      403,
      "Faltan permisos de ventas, caja o cuentas corrientes para esta operación",
    );
}

export async function inmobiliaria(
  method: string,
  path: string[],
  req: Request,
) {
  const [, resource, id, action] = path;
  const auth = await requirePermission(
    "inmobiliaria",
    method === "GET" ? "ver" : method === "PATCH" ? "editar" : "crear",
  );
  const cid = auth.company.companyId;
  if (id && !uuid.safeParse(id).success)
    throw new HttpError(400, "Identificador inválido");
  return withTenant(cid, auth.user.id, async (tx) => {
    if (method === "GET" && resource === "resumen") {
      const [properties, contracts, late, pending] = await Promise.all([
        tx.execute(
          sql`select status,count(*)::int as count from estate_properties group by status`,
        ),
        tx.execute(
          sql`select c.id,p.address,c.ends_on,c.last_adjustment_on,c.adjustment_months,c.adjustment_method from estate_contracts c join estate_properties p on p.id=c.property_id where c.status='activo' and (c.ends_on<=current_date+90 or c.last_adjustment_on+(c.adjustment_months||' months')::interval<=current_date+interval '1 month') order by c.ends_on limit 100`,
        ),
        tx.execute(
          sql`select c.id,c.period,p.address,u.name as tenant,c.due_on,(c.rent_cents+c.extras_cents-coalesce(r.paid,0))::text as pending_cents from estate_charges c join estate_contracts l on l.id=c.contract_id join estate_properties p on p.id=l.property_id join customers u on u.id=l.tenant_id left join lateral(select sum(rent_cents+extras_cents) as paid from estate_receipts r join documents d on d.id=r.document_id where r.charge_id=c.id and d.status='confirmado') r on true where c.due_on<current_date and c.rent_cents+c.extras_cents>coalesce(r.paid,0) order by c.due_on limit 100`,
        ),
        tx.execute(
          sql`select coalesce(sum(payable_cents) filter(where paid_on is null),0)::text as pending_cents,coalesce(sum(commission_cents),0)::text as commission_cents from estate_settlements`,
        ),
      ]);
      return ok({
        properties,
        alerts: contracts,
        late,
        settlements: pending[0],
      });
    }
    if (method === "GET" && resource === "propiedades") {
      const page = pageParams(new URL(req.url));
      const rows = await tx.execute(
        sql`select p.*,c.name as owner_name,count(*) over()::int as total from estate_properties p join customers c on c.id=p.owner_customer_id where p.address ilike ${`%${page.q}%`} order by p.address limit ${page.pageSize} offset ${page.offset}`,
      );
      return ok({ items: rows });
    }
    if (method === "POST" && resource === "propiedades" && !id) {
      const b = await readBody(req, propertySchema);
      await customer(tx, b.ownerCustomerId);
      await supplier(tx, b.ownerSupplierId);
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_properties(company_id,address,kind,owner_customer_id,owner_supplier_id,status,notes) values(${cid},${b.address},${b.kind},${b.ownerCustomerId},${b.ownerSupplierId},${b.status},${b.notes}) returning id`,
      );
      await audit(tx, auth, "propiedad.crear", row.id, b.address);
      return ok(row);
    }
    if (method === "PATCH" && resource === "propiedades" && id) {
      const b = await readBody(req, propertySchema);
      await customer(tx, b.ownerCustomerId);
      await supplier(tx, b.ownerSupplierId);
      const [previous] = await tx.execute<Row>(
        sql`select * from estate_properties where id=${id} for update`,
      );
      if (!previous) throw new HttpError(404, "No encontramos la propiedad");
      const active = await tx.execute(
        sql`select 1 from estate_contracts where property_id=${id} and status='activo'`,
      );
      if (
        active.length &&
        (previous.owner_customer_id !== b.ownerCustomerId ||
          previous.owner_supplier_id !== b.ownerSupplierId ||
          b.status !== "alquilada")
      )
        throw new HttpError(
          409,
          "La propiedad tiene un contrato activo; no se puede cambiar propietario ni disponibilidad",
        );
      await tx.execute(
        sql`update estate_properties set address=${b.address},kind=${b.kind},owner_customer_id=${b.ownerCustomerId},owner_supplier_id=${b.ownerSupplierId},status=${b.status},notes=${b.notes} where id=${id}`,
      );
      await audit(tx, auth, "propiedad.editar", id, b.address);
      return ok({ id });
    }
    if (method === "GET" && resource === "contratos") {
      return ok({
        items: await tx.execute(
          sql`select c.*,p.address,u.name as tenant_name from estate_contracts c join estate_properties p on p.id=c.property_id join customers u on u.id=c.tenant_id order by c.ends_on limit 100`,
        ),
      });
    }
    if (method === "POST" && resource === "contratos" && !id) {
      const b = await readBody(req, contractSchema);
      if (auth.company.taxCondition !== "ri" && b.commissionVatBps !== 0)
        throw new HttpError(
          400,
          "Esta empresa no discrimina IVA; elegí tasa cero para la comisión",
        );
      await customer(tx, b.tenantId);
      const [p] = await tx.execute<Row>(
        sql`select * from estate_properties where id=${b.propertyId} for update`,
      );
      if (!p) throw new HttpError(400, "Elegí una propiedad de esta empresa");
      if (p.status !== "disponible")
        throw new HttpError(409, "La propiedad no está disponible");
      const overlaps = await tx.execute(
        sql`select 1 from estate_contracts where property_id=${b.propertyId} and status='activo' and starts_on<=${b.endsOn}::date and ends_on>=${b.startsOn}::date`,
      );
      if (overlaps.length)
        throw new HttpError(409, "Hay otro contrato en esas fechas");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_contracts(company_id,property_id,owner_customer_id,owner_supplier_id,tenant_id,starts_on,ends_on,initial_rent_cents,current_rent_cents,adjustment_method,adjustment_months,fixed_adjustment_bps,commission_bps,commission_vat_bps,late_daily_bps,grace_days,deposit_cents,due_day,guarantors,last_adjustment_on) values(${cid},${b.propertyId},${p.owner_customer_id},${p.owner_supplier_id},${b.tenantId},${b.startsOn},${b.endsOn},${b.initialRentCents},${b.initialRentCents},${b.adjustmentMethod},${b.adjustmentMonths},${b.fixedAdjustmentBps},${b.commissionBps},${b.commissionVatBps},${b.lateDailyBps},${b.graceDays},${b.depositCents},${b.dueDay},${JSON.stringify(b.guarantors)}::jsonb,${b.startsOn}) returning id`,
      );
      await tx.execute(
        sql`update estate_properties set status='alquilada' where id=${b.propertyId}`,
      );
      await audit(
        tx,
        auth,
        "contrato.crear",
        row.id,
        "Contrato de alquiler creado",
      );
      return ok(row);
    }
    if (
      method === "PATCH" &&
      resource === "contratos" &&
      id &&
      action === "finalizar"
    ) {
      await readBody(req, z.object({ confirmation: z.literal("FINALIZAR") }));
      const [row] = await tx.execute<{ property_id: string }>(
        sql`update estate_contracts set status='finalizado' where id=${id} and status='activo' returning property_id`,
      );
      if (!row) throw new HttpError(404, "No encontramos un contrato activo");
      await tx.execute(
        sql`update estate_properties set status='disponible' where id=${row.property_id}`,
      );
      await audit(
        tx,
        auth,
        "contrato.finalizar",
        id,
        "Contrato finalizado; no anula deudas ni devuelve depósitos",
      );
      return ok({ id });
    }
    if (
      method === "PATCH" &&
      resource === "contratos" &&
      id &&
      action === "condiciones"
    ) {
      const b = await readBody(
        req,
        z.object({
          commissionBps: z.number().int().min(0).max(10000),
          commissionVatBps: vat,
          lateDailyBps: z.number().int().min(0).max(10000),
          graceDays: z.number().int().min(0).max(60),
        }),
      );
      if (auth.company.taxCondition !== "ri" && b.commissionVatBps !== 0)
        throw new HttpError(
          400,
          "Esta empresa no discrimina IVA; elegí tasa cero para la comisión",
        );
      const [row] = await tx.execute(
        sql`update estate_contracts set commission_bps=${b.commissionBps},commission_vat_bps=${b.commissionVatBps},late_daily_bps=${b.lateDailyBps},grace_days=${b.graceDays} where id=${id} and status='activo' returning id`,
      );
      if (!row) throw new HttpError(404, "No encontramos un contrato activo");
      await audit(
        tx,
        auth,
        "contrato.condiciones",
        id,
        "Condiciones cambiadas para cobros y liquidaciones futuros",
      );
      return ok({ id });
    }
    if (
      method === "POST" &&
      resource === "contratos" &&
      id &&
      action === "ajustar"
    ) {
      const b = await readBody(
        req,
        z.object({
          effectiveOn: date,
          coefficient: z.number().positive().max(1000).optional(),
          newRentCents: money.optional(),
          source: z.string().trim().min(1).max(250),
        }),
      );
      const [c] = await tx.execute<Row>(
        sql`select * from estate_contracts where id=${id} and status='activo' for update`,
      );
      if (!c) throw new HttpError(404, "No encontramos un contrato activo");
      const effective = b.effectiveOn;
      if (
        effective.slice(8) !== "01" ||
        effective <
          addMonths(
            String(c.last_adjustment_on),
            Number(c.adjustment_months),
          ) ||
        effective > String(c.ends_on)
      )
        throw new HttpError(
          400,
          "El ajuste debe ser el primer día de un mes y respetar el período pactado",
        );
      const hasCharges = await tx.execute(
        sql`select 1 from estate_charges where contract_id=${id} and period>=${effective.slice(0, 7)}`,
      );
      if (hasCharges.length)
        throw new HttpError(
          409,
          "Ya hay liquidaciones para ese período; no se cambia el alquiler retroactivamente",
        );
      const old = Number(c.current_rent_cents);
      const next =
        c.adjustment_method === "fijo"
          ? old + applyRate(old, Number(c.fixed_adjustment_bps))
          : c.adjustment_method === "manual"
            ? b.newRentCents
            : b.coefficient
              ? Math.round(old * b.coefficient)
              : undefined;
      if (!next || !Number.isSafeInteger(next) || next > 1_000_000_000_000)
        throw new HttpError(
          400,
          "Indicá un alquiler o coeficiente válido según el método",
        );
      await tx.execute(
        sql`insert into estate_adjustments(company_id,contract_id,effective_on,old_cents,new_cents,coefficient,source) values(${cid},${id},${effective},${old},${next},${next / old},${b.source})`,
      );
      await tx.execute(
        sql`update estate_contracts set current_rent_cents=${next},last_adjustment_on=${effective} where id=${id}`,
      );
      await audit(
        tx,
        auth,
        "contrato.ajustar",
        id,
        `Ajuste ${c.adjustment_method}: ${b.source}`,
      );
      return ok({ rentCents: next });
    }
    if (method === "GET" && resource === "liquidaciones") {
      return ok({
        items: await tx.execute(
          sql`select c.*,p.address,u.name as tenant_name,coalesce(r.rent_paid,0)::text as rent_paid_cents,coalesce(r.extras_paid,0)::text as extras_paid_cents from estate_charges c join estate_contracts l on l.id=c.contract_id join estate_properties p on p.id=l.property_id join customers u on u.id=l.tenant_id left join lateral(select sum(rent_cents) as rent_paid,sum(extras_cents) as extras_paid from estate_receipts r join documents d on d.id=r.document_id where r.charge_id=c.id and d.status='confirmado') r on true order by c.period desc,p.address limit 100`,
        ),
      });
    }
    if (method === "POST" && resource === "liquidaciones" && !id) {
      also(auth, "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          contractId: uuid,
          period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          expensesCents: money.default(0),
          taxesCents: money.default(0),
          servicesCents: money.default(0),
          asOf: date,
          notes: z.string().max(1000).default(""),
        }),
      );
      const [c] = await tx.execute<Row>(
        sql`select * from estate_contracts where id=${b.contractId} for update`,
      );
      if (!c || c.status !== "activo")
        throw new HttpError(404, "No encontramos un contrato activo");
      const first = `${b.period}-01`;
      const last = addMonths(first, 1);
      if (first > String(c.ends_on) || last <= String(c.starts_on))
        throw new HttpError(400, "El período no pertenece al contrato");
      const [adjustment] = await tx.execute<{ new_cents: string }>(
        sql`select new_cents::text from estate_adjustments where contract_id=${b.contractId} and effective_on<=${first}::date order by effective_on desc limit 1`,
      );
      const rent = Number(adjustment?.new_cents ?? c.initial_rent_cents);
      const due = `${b.period}-${String(c.due_day).padStart(2, "0")}`;
      const penalty = leasePenalty(
        rent,
        Number(c.late_daily_bps),
        due,
        b.asOf,
        Number(c.grace_days),
      );
      const extras = b.expensesCents + b.taxesCents + b.servicesCents + penalty;
      if (rent + extras > 1_000_000_000_000)
        throw new HttpError(400, "El total excede el máximo permitido");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_charges(company_id,contract_id,period,due_on,rent_cents,extras_cents,expenses_cents,taxes_cents,services_cents,penalty_cents,notes) values(${cid},${b.contractId},${b.period},${due},${rent},${extras},${b.expensesCents},${b.taxesCents},${b.servicesCents},${penalty},${b.notes}) returning id`,
      );
      await tx.insert(currentAccountEntries).values({
        companyId: cid,
        partyType: "customer",
        partyId: String(c.tenant_id),
        occurredOn: b.asOf,
        description: `Alquiler ${b.period} · ${row.id}`,
        debitCents: rent + extras,
      });
      await audit(
        tx,
        auth,
        "liquidacion.crear",
        row.id,
        `Alquiler ${b.period}`,
      );
      return ok({
        id: row.id,
        rentCents: rent,
        extrasCents: extras,
        penaltyCents: penalty,
      });
    }
    if (
      method === "POST" &&
      resource === "liquidaciones" &&
      id &&
      action === "cobrar"
    ) {
      also(auth, "ventas.crear", "cuentas_corrientes.crear", "caja.crear");
      const b = await readBody(
        req,
        z.object({
          rentCents: money,
          extrasCents: money,
          cashAccountId: uuid,
          occurredOn: date,
        }),
      );
      if (b.rentCents + b.extrasCents <= 0)
        throw new HttpError(400, "El cobro debe ser mayor a cero");
      await cash(tx, b.cashAccountId);
      const [charge] = await tx.execute<Row>(
        sql`select * from estate_charges where id=${id} for update`,
      );
      if (!charge) throw new HttpError(404, "No encontramos la liquidación");
      const [paid] = await tx.execute<{ rent: string; extras: string }>(
        sql`select coalesce(sum(r.rent_cents),0)::text as rent,coalesce(sum(r.extras_cents),0)::text as extras from estate_receipts r join documents d on d.id=r.document_id where r.charge_id=${id} and d.status='confirmado'`,
      );
      if (
        b.rentCents + Number(paid.rent) > Number(charge.rent_cents) ||
        b.extrasCents + Number(paid.extras) > Number(charge.extras_cents)
      )
        throw new HttpError(
          409,
          "El cobro supera el saldo del alquiler o de los adicionales",
        );
      const [contract] = await tx.execute<Row>(
        sql`select * from estate_contracts where id=${charge.contract_id}`,
      );
      const receipt = await doc(
        tx,
        auth,
        "REC",
        String(contract.tenant_id),
        b.rentCents + b.extrasCents,
        b.occurredOn,
        {
          cashAccountId: b.cashAccountId,
          description: `Recibo alquiler ${charge.period}`,
          receipt: true,
        },
      );
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_receipts(company_id,charge_id,commission_bps,commission_vat_bps,document_id,rent_cents,extras_cents,occurred_on) values(${cid},${id},${contract.commission_bps},${contract.commission_vat_bps},${receipt.id},${b.rentCents},${b.extrasCents},${b.occurredOn}) returning id`,
      );
      await audit(tx, auth, "cobro", row.id, "Cobro de alquiler y adicionales");
      return ok({ id: row.id, documentId: receipt.id });
    }
    if (method === "GET" && resource === "cobros")
      return ok({
        items: await tx.execute(
          sql`select r.*,d.status as receipt_status,c.period,p.address,s.id as settlement_id from estate_receipts r join documents d on d.id=r.document_id join estate_charges c on c.id=r.charge_id join estate_contracts l on l.id=c.contract_id join estate_properties p on p.id=l.property_id left join estate_settlements s on s.receipt_id=r.id order by r.occurred_on desc limit 100`,
        ),
      });
    if (method === "GET" && resource === "propietarios")
      return ok({
        items: await tx.execute(
          sql`select s.*,c.name as owner_name from estate_settlements s join customers c on c.id=s.owner_customer_id order by s.id limit 100`,
        ),
      });
    if (method === "POST" && resource === "propietarios" && !id) {
      also(auth, "ventas.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({
          receiptId: uuid,
          expensesCents: money.default(0),
          occurredOn: date,
        }),
      );
      const [r] = await tx.execute<Row>(
        sql`select r.*,d.status as receipt_status from estate_receipts r join documents d on d.id=r.document_id where r.id=${b.receiptId} for update of r,d`,
      );
      if (!r || r.receipt_status !== "confirmado")
        throw new HttpError(409, "El recibo no está confirmado");
      const [c] = await tx.execute<Row>(
        sql`select l.* from estate_charges ch join estate_contracts l on l.id=ch.contract_id where ch.id=${r.charge_id}`,
      );
      const amounts = settlementAmounts(
        Number(r.rent_cents),
        Number(r.extras_cents),
        Number(r.commission_bps),
        Number(r.commission_vat_bps),
        b.expensesCents,
      );
      if (amounts.payable < 0)
        throw new HttpError(400, "Comisión y gastos superan lo cobrado");
      const invoice =
        amounts.commission > 0
          ? await doc(
              tx,
              auth,
              "FAC",
              String(c.owner_customer_id),
              amounts.commission,
              b.occurredOn,
              {
                description: "Comisión por administración de alquiler",
                vatBps: Number(r.commission_vat_bps),
              },
            )
          : null;
      if (invoice) {
        amounts.totalCommission = invoice.totalCents;
        amounts.payable =
          Number(r.rent_cents) +
          Number(r.extras_cents) -
          invoice.totalCents -
          b.expensesCents;
      }
      if (amounts.payable < 0)
        throw new HttpError(
          400,
          "La comisión con sus impuestos y los gastos superan lo cobrado",
        );
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_settlements(company_id,receipt_id,owner_customer_id,owner_supplier_id,collected_cents,commission_cents,commission_total_cents,expenses_cents,payable_cents,invoice_id) values(${cid},${r.id},${c.owner_customer_id},${c.owner_supplier_id},${Number(r.rent_cents) + Number(r.extras_cents)},${amounts.commission},${amounts.totalCommission},${b.expensesCents},${amounts.payable},${invoice?.id ?? null}) returning id`,
      );
      await tx.insert(currentAccountEntries).values({
        companyId: cid,
        partyType: "supplier",
        partyId: String(c.owner_supplier_id),
        occurredOn: b.occurredOn,
        description: `Liquidación propietario ${row.id}`,
        businessOperationId: row.id,
        creditCents: amounts.payable,
      });
      if (invoice)
        await tx.insert(currentAccountEntries).values({
          companyId: cid,
          partyType: "customer",
          partyId: String(c.owner_customer_id),
          documentId: invoice.id,
          occurredOn: b.occurredOn,
          description: `Comisión retenida de alquiler ${row.id}`,
          creditCents: amounts.totalCommission,
        });
      await audit(
        tx,
        auth,
        "propietario.liquidar",
        row.id,
        "Comisión facturada y retenida; neto a pagar al propietario",
      );
      return ok({ id: row.id, ...amounts, invoiceId: invoice?.id });
    }
    if (
      method === "POST" &&
      resource === "propietarios" &&
      id &&
      action === "pagar"
    ) {
      also(auth, "caja.crear", "cuentas_corrientes.crear");
      const b = await readBody(
        req,
        z.object({ cashAccountId: uuid, occurredOn: date }),
      );
      await cash(tx, b.cashAccountId);
      const [s] = await tx.execute<Row>(
        sql`select * from estate_settlements where id=${id} for update`,
      );
      if (!s) throw new HttpError(404, "No encontramos la liquidación");
      if (s.paid_on) throw new HttpError(409, "Ya fue pagada");
      const [company] = await tx.execute<{ allow_negative_cash: boolean }>(
        sql`select allow_negative_cash from companies where id=${cid}`,
      );
      const [balance] = await tx.execute<{ cents: string }>(
        sql`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::text as cents from cash_movements where cash_account_id=${b.cashAccountId}`,
      );
      const amount = Number(s.payable_cents);
      if (
        cashOutAllowed(
          Number(balance.cents),
          amount,
          company.allow_negative_cash,
        )
      )
        throw new HttpError(409, "No hay saldo suficiente en la caja");
      if (amount > 0) {
        await tx.insert(cashMovements).values({
          companyId: cid,
          cashAccountId: b.cashAccountId,
          direction: "out",
          amountCents: amount,
          description: `Orden de pago inmobiliaria ${id}`,
          businessOperationId: id,
          occurredOn: b.occurredOn,
          createdBy: auth.user.id,
        });
        await tx.insert(currentAccountEntries).values({
          companyId: cid,
          partyType: "supplier",
          partyId: String(s.owner_supplier_id),
          occurredOn: b.occurredOn,
          description: `Orden de pago inmobiliaria ${id}`,
          businessOperationId: id,
          debitCents: amount,
        });
      }
      await tx.execute(
        sql`update estate_settlements set paid_on=${b.occurredOn} where id=${id}`,
      );
      await audit(
        tx,
        auth,
        "propietario.pagar",
        id,
        "Orden de pago al propietario",
      );
      return ok({ id });
    }
    if (method === "POST" && resource === "adjuntos" && !id) {
      const b = await readBody(
        req,
        z.object({
          propertyId: uuid,
          filename: z.string().trim().min(1).max(150),
          mime: z.enum([
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ]),
          contentBase64: z
            .string()
            .max(7_000_000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        }),
      );
      const [property] = await tx.execute(
        sql`select id from estate_properties where id=${b.propertyId}`,
      );
      if (!property) throw new HttpError(404, "No encontramos la propiedad");
      const bytes = Buffer.from(b.contentBase64, "base64");
      if (!bytes.length || bytes.length > 5_000_000)
        throw new HttpError(400, "El archivo debe tener entre 1 byte y 5 MB");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_attachments(company_id,property_id,filename,mime,content_base64) values(${cid},${b.propertyId},${b.filename},${b.mime},${b.contentBase64}) returning id`,
      );
      await audit(tx, auth, "adjunto.crear", row.id, b.filename);
      return ok(row);
    }
    if (method === "GET" && resource === "adjuntos") {
      if (id) {
        const [row] = await tx.execute<{
          filename: string;
          mime: string;
          content_base64: string;
        }>(
          sql`select filename,mime,content_base64 from estate_attachments where id=${id}`,
        );
        if (!row) throw new HttpError(404, "No encontramos el archivo");
        return new Response(Buffer.from(row.content_base64, "base64"), {
          headers: {
            "Content-Type": row.mime,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const propertyId = new URL(req.url).searchParams.get("propertyId");
      if (!uuid.safeParse(propertyId).success)
        throw new HttpError(400, "Elegí una propiedad");
      return ok({
        items: await tx.execute(
          sql`select id,filename,mime from estate_attachments where property_id=${propertyId}`,
        ),
      });
    }
    if (method === "GET" && resource === "ventas")
      return ok({
        items: await tx.execute(
          sql`select s.*,p.address,c.name as buyer_name from estate_sales s join estate_properties p on p.id=s.property_id join customers c on c.id=s.buyer_id order by p.address limit 100`,
        ),
      });
    if (method === "POST" && resource === "ventas" && !id) {
      const b = await readBody(
        req,
        z.object({
          propertyId: uuid,
          buyerId: uuid,
          priceCents: money.refine((v) => v > 0),
          commissionCents: money.default(0),
          commissionVatBps: vat.default(0),
          commissionPartyId: uuid,
          notes: z.string().max(2000).default(""),
        }),
      );
      await customer(tx, b.buyerId);
      await customer(tx, b.commissionPartyId);
      const [p] = await tx.execute<Row>(
        sql`select * from estate_properties where id=${b.propertyId} for update`,
      );
      if (!p || p.status !== "disponible")
        throw new HttpError(409, "La propiedad no está disponible");
      const [row] = await tx.execute<{ id: string }>(
        sql`insert into estate_sales(company_id,property_id,buyer_id,price_cents,commission_cents,commission_vat_bps,commission_party_id,notes) values(${cid},${b.propertyId},${b.buyerId},${b.priceCents},${b.commissionCents},${b.commissionVatBps},${b.commissionPartyId},${b.notes}) returning id`,
      );
      await tx.execute(
        sql`update estate_properties set status='reservada' where id=${b.propertyId}`,
      );
      await audit(tx, auth, "venta.reserva", row.id, "Reserva de propiedad");
      return ok(row);
    }
    if (method === "PATCH" && resource === "ventas" && id) {
      const b = await readBody(
        req,
        z.object({
          stage: z.enum(["sena", "boleto", "escritura", "cancelada"]),
          notes: z.string().max(2000).default(""),
        }),
      );
      const [s] = await tx.execute<Row>(
        sql`select * from estate_sales where id=${id} for update`,
      );
      if (!s) throw new HttpError(404, "No encontramos la operación");
      const stages = ["reserva", "sena", "boleto", "escritura"];
      if (
        s.stage === "escritura" ||
        s.stage === "cancelada" ||
        (b.stage !== "cancelada" &&
          stages.indexOf(b.stage) !== stages.indexOf(String(s.stage)) + 1)
      )
        throw new HttpError(409, "La transición de la venta no corresponde");
      if (
        b.stage === "cancelada" &&
        (s.deposit_receipt_id || s.commission_invoice_id)
      )
        throw new HttpError(
          409,
          "Primero hay que resolver o anular los comprobantes asociados; no se devuelve dinero automáticamente",
        );
      await tx.execute(
        sql`update estate_sales set stage=${b.stage},notes=${b.notes} where id=${id}`,
      );
      await tx.execute(
        sql`update estate_properties set status=${b.stage === "escritura" ? "vendida" : b.stage === "cancelada" ? "disponible" : "reservada"} where id=${s.property_id}`,
      );
      await audit(tx, auth, "venta.etapa", id, `Etapa ${b.stage}`);
      return ok({ id });
    }
    if (method === "POST" && resource === "ventas" && id && action === "sena") {
      also(auth, "ventas.crear", "cuentas_corrientes.crear", "caja.crear");
      const b = await readBody(
        req,
        z.object({
          amountCents: money.refine((v) => v > 0),
          cashAccountId: uuid,
          occurredOn: date,
        }),
      );
      await cash(tx, b.cashAccountId);
      const [s] = await tx.execute<Row>(
        sql`select * from estate_sales where id=${id} for update`,
      );
      if (!s || s.deposit_receipt_id || s.stage !== "reserva")
        throw new HttpError(409, "La venta ya tiene seña o no está en reserva");
      if (b.amountCents > Number(s.price_cents))
        throw new HttpError(400, "La seña supera el precio de la propiedad");
      const receipt = await doc(
        tx,
        auth,
        "REC",
        String(s.buyer_id),
        b.amountCents,
        b.occurredOn,
        {
          description: `Seña de propiedad ${id}`,
          receipt: true,
          cashAccountId: b.cashAccountId,
        },
      );
      await tx.execute(
        sql`update estate_sales set deposit_receipt_id=${receipt.id},stage='sena' where id=${id}`,
      );
      await audit(
        tx,
        auth,
        "venta.sena",
        id,
        "Seña guardada como anticipo del comprador; no implica transferirla al propietario",
      );
      return ok({ id, documentId: receipt.id });
    }
    if (
      method === "POST" &&
      resource === "ventas" &&
      id &&
      action === "facturar"
    ) {
      also(auth, "ventas.crear", "cuentas_corrientes.crear");
      const b = await readBody(req, z.object({ occurredOn: date }));
      const [s] = await tx.execute<Row>(
        sql`select * from estate_sales where id=${id} for update`,
      );
      if (
        !s ||
        s.commission_invoice_id ||
        s.stage === "cancelada" ||
        Number(s.commission_cents) <= 0
      )
        throw new HttpError(409, "No hay una comisión pendiente de facturar");
      const invoice = await doc(
        tx,
        auth,
        "FAC",
        String(s.commission_party_id),
        Number(s.commission_cents),
        b.occurredOn,
        {
          description: `Honorarios por venta de propiedad ${id}`,
          vatBps: Number(s.commission_vat_bps),
        },
      );
      await tx.execute(
        sql`update estate_sales set commission_invoice_id=${invoice.id} where id=${id}`,
      );
      await audit(
        tx,
        auth,
        "venta.facturar",
        id,
        "Honorarios facturados a cuenta corriente",
      );
      return ok({ id, documentId: invoice.id });
    }
    throw new HttpError(404, "No existe esa ruta inmobiliaria");
  });
}
