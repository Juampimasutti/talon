import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission, type AuthContext } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { voidDocument } from "@/lib/domain/documents";
import { writeAudit } from "@/lib/domain/audit";
import { HttpError, ok } from "@/lib/http";
import { readBody } from "@/lib/validation";
import { todayIso } from "@/lib/format";

type Row = Record<string, unknown>;
type Sector = "inmobiliaria" | "constructora";
const TABLES: Record<Sector, Record<string, string>> = {
  inmobiliaria: {
    cobros: "estate_receipts",
    propietarios: "estate_settlements",
  },
  constructora: {
    anticipos: "construction_advances",
    certificados: "construction_certificates",
    cobros: "construction_collections",
    cuotas: "construction_installment_receipts",
    reparos: "construction_releases",
  },
};
class PreviewRollback extends Error {
  constructor(public result: unknown) {
    super("Vista previa sin cambios");
  }
}

async function reverse(
  tx: Tx,
  auth: AuthContext,
  sector: Sector,
  resource: string,
  id: string,
  reason: string,
) {
  const archived: { resource: string; id: string; data: Row }[] = [];
  const documents: Row[] = [];
  const effects: string[] = [];
  const cashChanges = new Map<string, number>();
  const accountChanges = new Map<
    string,
    { party: string; deltaCents: number }
  >();
  const cid = auth.company.companyId;
  const ctx = { companyId: cid, userId: auth.user.id };
  function rememberCash(account: string, delta: number) {
    cashChanges.set(account, (cashChanges.get(account) ?? 0) + delta);
  }
  function rememberAccount(type: string, party: string, delta: number) {
    const key = `${type}:${party}`;
    accountChanges.set(key, {
      party: key,
      deltaCents: (accountChanges.get(key)?.deltaCents ?? 0) + delta,
    });
  }
  async function row(table: string, rowId: string) {
    const [value] = await tx.execute<Row>(
      sql`select * from ${sql.identifier(table)} where id=${rowId}::uuid for update`,
    );
    if (!value)
      throw new HttpError(404, "La operación no existe o ya fue anulada");
    return value;
  }
  async function archive(key: string, data: Row) {
    archived.push({ resource: key, id: String(data.id), data });
    await tx.execute(
      sql`insert into business_reversals(company_id,sector,resource,operation_id,reason,snapshot,user_id) values(${cid},${sector},${key},${String(data.id)}::uuid,${reason},${JSON.stringify(data)}::jsonb,${auth.user.id})`,
    );
  }
  async function remove(table: string, rowId: string) {
    await tx.execute(
      sql`delete from ${sql.identifier(table)} where id=${rowId}::uuid`,
    );
  }
  async function undoDocument(docId: string) {
    const d = await row("documents", docId);
    documents.push(d);
    if (d.status === "anulado") return;
    if (d.cae)
      throw new HttpError(
        409,
        "El comprobante tiene autorización fiscal. Su corrección fiscal queda pendiente; no se modificó la operación.",
      );
    const derived = await tx.execute(
      sql`select 1 from documents where source_document_id=${docId}::uuid and status='confirmado' limit 1`,
    );
    if (derived.length)
      throw new HttpError(
        409,
        "Primero corregí los comprobantes derivados de esta factura",
      );
    const entries = await tx.execute<Row>(
      sql`select * from current_account_entries where document_id=${docId}::uuid order by id`,
    );
    for (const e of entries)
      rememberAccount(
        String(e.party_type),
        String(e.party_id),
        Number(e.credit_cents) - Number(e.debit_cents),
      );
    const cash = await tx.execute<Row>(
      sql`select * from cash_movements where document_id=${docId}::uuid order by id`,
    );
    for (const e of cash)
      rememberCash(
        String(e.cash_account_id),
        (e.direction === "in" ? -1 : 1) * Number(e.amount_cents),
      );
    await voidDocument(tx, ctx, docId, reason);
  }
  async function undoSettlement(settlementId: string) {
    const s = await row("estate_settlements", settlementId);
    await archive("propietarios", s);
    const cash = await tx.execute<Row>(
      sql`select * from cash_movements where business_operation_id=${settlementId}::uuid order by id`,
    );
    const entries = await tx.execute<Row>(
      sql`select * from current_account_entries where business_operation_id=${settlementId}::uuid order by id`,
    );
    // Las operaciones anteriores sin vínculo verificable no se compensan por aproximación.
    if (Number(s.payable_cents) > 0 && !entries.length)
      throw new HttpError(
        409,
        "La liquidación no tiene movimientos vinculados verificables; requiere revisión técnica",
      );
    for (const e of cash) {
      rememberCash(
        String(e.cash_account_id),
        (e.direction === "in" ? -1 : 1) * Number(e.amount_cents),
      );
      await tx.execute(
        sql`insert into cash_movements(company_id,cash_account_id,direction,amount_cents,description,occurred_on,created_by) values(${cid},${String(e.cash_account_id)}::uuid,${e.direction === "in" ? "out" : "in"},${Number(e.amount_cents)},${`Reversión de pago inmobiliario ${settlementId}: ${reason}`},${todayIso()},${auth.user.id})`,
      );
    }
    for (const e of entries) {
      rememberAccount(
        String(e.party_type),
        String(e.party_id),
        Number(e.credit_cents) - Number(e.debit_cents),
      );
      await tx.execute(
        sql`insert into current_account_entries(company_id,party_type,party_id,occurred_on,description,debit_cents,credit_cents) values(${cid},${String(e.party_type)},${String(e.party_id)}::uuid,${todayIso()},${`Reversión de liquidación ${settlementId}: ${reason}`},${Number(e.credit_cents)},${Number(e.debit_cents)})`,
      );
    }
    await remove("estate_settlements", settlementId);
    if (s.invoice_id) await undoDocument(String(s.invoice_id));
    effects.push(
      s.paid_on
        ? "Se revierte el pago al propietario, su cuenta corriente y la comisión facturada. Confirmá también la devolución efectiva del dinero."
        : "Se revierte la liquidación al propietario y su comisión facturada.",
    );
  }
  if (sector === "inmobiliaria") {
    if (resource === "propietarios") await undoSettlement(id);
    else {
      const r = await row("estate_receipts", id);
      const settlements = await tx.execute<Row>(
        sql`select id from estate_settlements where receipt_id=${id}::uuid order by id`,
      );
      for (const s of settlements) await undoSettlement(String(s.id));
      await archive(resource, r);
      await remove("estate_receipts", id);
      await undoDocument(String(r.document_id));
      effects.push(
        "Se revierte el recibo; el alquiler vuelve a quedar pendiente de cobro.",
      );
    }
  } else {
    const table = TABLES.constructora[resource];
    const r = await row(table, id);
    if (resource === "anticipos") {
      const certs = await tx.execute(
        sql`select 1 from construction_certificates where work_id=${String(r.work_id)}::uuid limit 1`,
      );
      if (certs.length)
        throw new HttpError(
          409,
          "Primero anulá los certificados de esta obra, desde el más reciente",
        );
      if (!r.invoice_id)
        throw new HttpError(
          409,
          "Este anticipo anterior no tiene factura vinculada; requiere revisión técnica",
        );
      await archive(resource, r);
      await remove(table, id);
      await undoDocument(String(r.receipt_id));
      await undoDocument(String(r.invoice_id));
      effects.push(
        "Se anulan juntos la factura y el recibo de anticipo; se revierte caja y se libera el anticipo reservado.",
      );
    } else if (resource === "certificados") {
      if (Number(r.fiscal_version) !== 2)
        throw new HttpError(
          409,
          "El certificado pertenece al criterio fiscal anterior; requiere revisión técnica",
        );
      const later = await tx.execute(
        sql`select 1 from construction_certificates where work_id=${String(r.work_id)}::uuid and period>${String(r.period)} limit 1`,
      );
      if (later.length)
        throw new HttpError(
          409,
          "Primero anulá el certificado más reciente de esta obra",
        );
      const release = await tx.execute(
        sql`select 1 from construction_releases where work_id=${String(r.work_id)}::uuid limit 1`,
      );
      if (release.length)
        throw new HttpError(
          409,
          "Primero revertí la liberación del fondo de reparo",
        );
      const collections = await tx.execute<Row>(
        sql`select * from construction_collections where certificate_id=${id}::uuid order by id`,
      );
      for (const c of collections) {
        await archive("cobros", c);
        await remove("construction_collections", String(c.id));
        await undoDocument(String(c.receipt_id));
      }
      const lines = await tx.execute<Row>(
        sql`select * from construction_certificate_lines where certificate_id=${id}::uuid order by id`,
      );
      await archive(resource, { ...r, lines });
      await tx.execute(
        sql`delete from construction_certificate_lines where certificate_id=${id}::uuid`,
      );
      await remove(table, id);
      await undoDocument(String(r.invoice_id));
      await tx.execute(
        sql`update construction_items i set certified_cents=coalesce((select l.cumulative_cents from construction_certificate_lines l join construction_certificates c on c.id=l.certificate_id where l.item_id=i.id order by c.period desc limit 1),0),certified_quantity_milli=coalesce((select l.cumulative_quantity_milli from construction_certificate_lines l join construction_certificates c on c.id=l.certificate_id where l.item_id=i.id order by c.period desc limit 1),0),certified_bps=coalesce((select l.cumulative_bps from construction_certificate_lines l join construction_certificates c on c.id=l.certificate_id where l.item_id=i.id order by c.period desc limit 1),0) where i.work_id=${String(r.work_id)}::uuid`,
      );
      effects.push(
        "Se revierte el certificado con todos sus cobros; se restauran las mediciones anteriores, el anticipo recuperado y el reparo pendiente.",
      );
    } else if (resource === "reparos") {
      if (r.invoice_id)
        throw new HttpError(
          409,
          "La liberación anterior generó factura; requiere revisión técnica",
        );
      const over = await tx.execute(
        sql`select c.id from construction_certificates c left join(select certificate_id,sum(amount_cents) as paid from construction_collections group by certificate_id)p on p.certificate_id=c.id where c.work_id=${String(r.work_id)}::uuid and coalesce(p.paid,0)>c.total_cents-c.repair_cents limit 1`,
      );
      if (over.length)
        throw new HttpError(
          409,
          "Primero revertí los cobros que incluyeron el fondo de reparo",
        );
      await archive(resource, r);
      await remove(table, id);
      effects.push(
        "El fondo de reparo vuelve a quedar retenido. No se genera factura ni IVA.",
      );
    } else {
      await archive(resource, r);
      await remove(table, id);
      await undoDocument(String(r.receipt_id));
      if (resource === "cuotas")
        await tx.execute(
          sql`update construction_installments set paid_cents=paid_cents-${Number(r.amount_cents)} where id=${String(r.installment_id)}::uuid`,
        );
      effects.push(
        resource === "cuotas"
          ? "La cuota vuelve a quedar pendiente por el importe del recibo anulado."
          : "El certificado vuelve a quedar pendiente por el importe del cobro anulado.",
      );
    }
  }
  // Verificar cada caja después de todas las compensaciones de la transacción.
  const [company] = await tx.execute<{ allow_negative_cash: boolean }>(
    sql`select allow_negative_cash from companies where id=${cid}`,
  );
  for (const [account, delta] of cashChanges) {
    if (delta >= 0 || company.allow_negative_cash) continue;
    await tx.execute(
      sql`select id from cash_accounts where id=${account}::uuid for update`,
    );
    const [balance] = await tx.execute<{ amount: string }>(
      sql`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0)::text as amount from cash_movements where cash_account_id=${account}::uuid`,
    );
    if (Number(balance.amount) < 0)
      throw new HttpError(
        409,
        "La reversión dejaría una caja negativa. Revisá los movimientos posteriores antes de continuar.",
      );
  }
  const details = {
    operations: archived,
    documents: documents.sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    ),
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(details))
    .digest("hex");
  const cashDeltaCents = [...cashChanges.values()].reduce((a, b) => a + b, 0);
  await writeAudit(tx, {
    ...ctx,
    action: `${sector}.revertir`,
    entity: resource,
    entityId: id,
    summary: `Reversión coordinada: ${reason}`,
    metadata: {
      fingerprint,
      documents: documents.map((d) => d.id),
      cashDeltaCents,
    },
  });
  return {
    fingerprint,
    effects,
    cashDeltaCents,
    documentCount: documents.filter((d) => d.status !== "anulado").length,
    accountChanges: [...accountChanges.values()],
    operationCount: archived.length,
  };
}

export async function reversals(method: string, path: string[], req: Request) {
  const [, rawSector, resource, id] = path;
  if (rawSector !== "inmobiliaria" && rawSector !== "constructora")
    throw new HttpError(404, "No existe ese circuito");
  const sector: Sector = rawSector;
  const auth = await requirePermission(
    sector,
    method === "GET" ? "ver" : "anular",
  );
  if (!resource && method === "GET")
    return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
      const items =
        sector === "inmobiliaria"
          ? await tx.execute(sql`
      select 'cobros' as resource,r.id,'Cobro de alquiler '||c.period||' · '||p.address as label from estate_receipts r join documents d on d.id=r.document_id join estate_charges c on c.id=r.charge_id join estate_contracts l on l.id=c.contract_id join estate_properties p on p.id=l.property_id where d.status='confirmado'
      union all select 'propietarios',s.id,'Liquidación propietario · '||c.name from estate_settlements s join customers c on c.id=s.owner_customer_id limit 100`)
          : await tx.execute(sql`
      select 'anticipos' as resource,a.id,'Anticipo · '||w.name as label from construction_advances a join construction_works w on w.id=a.work_id
      union all select 'certificados',c.id,'Certificado '||c.period||' · '||w.name from construction_certificates c join construction_works w on w.id=c.work_id
      union all select 'cobros',p.id,'Cobro de certificado '||c.period||' · '||w.name from construction_collections p join construction_certificates c on c.id=p.certificate_id join construction_works w on w.id=c.work_id
      union all select 'cuotas',p.id,'Cobro cuota '||i.number||' · '||u.name from construction_installment_receipts p join construction_installments i on i.id=p.installment_id join construction_unit_contracts c on c.id=i.contract_id join construction_units u on u.id=c.unit_id
      union all select 'reparos',r.id,'Liberación de reparo · '||w.name from construction_releases r join construction_works w on w.id=r.work_id limit 100`);
      const history = await tx.execute(
        sql`select r.id,r.resource,r.reason,r.created_at,u.name as user_name from business_reversals r join users u on u.id=r.user_id where r.sector=${sector} order by r.created_at desc limit 50`,
      );
      return ok({ items, history });
    });
  if (
    !Object.hasOwn(TABLES[sector],resource) ||
    !z.string().uuid().safeParse(id).success ||
    !["GET", "POST"].includes(method)
  )
    throw new HttpError(404, "No existe esa operación");
  for (const p of [
    "ventas.anular",
    "ventas.ver",
    "caja.ver",
    "cuentas_corrientes.ver",
    "caja.anular",
    "cuentas_corrientes.anular",
    `${sector}.anular`,
    `${sector}.editar`,
  ])
    if (!auth.permissions.has(p))
      throw new HttpError(
        403,
        "Necesitás permiso para anular en este módulo, ventas, caja y cuentas corrientes",
      );
  const body =
    method === "POST"
      ? await readBody(
          req,
          z.object({
            reason: z
              .string()
              .trim()
              .min(5, "Explicá el motivo (al menos 5 caracteres)")
              .max(500),
            confirmation: z.literal("ANULAR"),
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
      : null;
  try {
    return await withTenant(
      auth.company.companyId,
      auth.user.id,
      async (tx) => {
        const result = await reverse(
          tx,
          auth,
          sector,
          resource,
          id,
          body?.reason ?? "Vista previa de reversión",
        );
        if (!body) throw new PreviewRollback(result);
        if (result.fingerprint !== body.fingerprint)
          throw new HttpError(
            409,
            "La operación cambió. Volvé a calcular la vista previa antes de confirmar.",
          );
        return ok(result);
      },
      "exclusive",
    );
  } catch (error) {
    if (error instanceof PreviewRollback) return ok(error.result);
    throw error;
  }
}
