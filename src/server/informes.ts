import { sql } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/lib/db/tenant";
import { ageLedger } from "@/lib/cuentas/aging";
import { reconcileTank, windowLiters } from "@/lib/estacion/calc";
import { formatQty, paymentLabel, todayIso } from "@/lib/format";
import { writeWorkbook } from "@/lib/io/excel";
import { HttpError, ok } from "@/lib/http";

const TIPOS = [
  "ventas",
  "compras",
  "iva-ventas",
  "iva-compras",
  "cuentas",
  "antiguedad",
  "stock",
  "movimientos",
  "mermas",
  "caja",
  "turnos",
  "vales",
  "reparto",
  "rentabilidad",
] as const;

export async function informes(method: string, url: URL): Promise<Response> {
  if (method !== "GET") throw new HttpError(404, "No existe esa ruta");
  const auth = await requirePermission("informes", "ver");
  const tipo = url.searchParams.get("tipo") ?? "ventas";
  if (!(TIPOS as readonly string[]).includes(tipo)) throw new HttpError(400, "No conocemos ese informe");
  const desde = url.searchParams.get("desde") ?? todayIso(new Date(Date.now() - 30 * 864e5));
  const hasta = url.searchParams.get("hasta") ?? todayIso();
  const sucursal = (url.searchParams.get("deposito") ?? url.searchParams.get("sucursal") ?? "").trim();
  const formato = url.searchParams.get("formato") ?? "json";
  if (formato === "xlsx" && !can(auth.permissions, "informes", "exportar")) throw new HttpError(403, "No podés exportar informes");
  return withTenant(auth.company.companyId, auth.user.id, async (tx) => {
    const report = await build(tx, auth.company.companyId, tipo, desde, hasta, sucursal);
    if (formato === "xlsx") {
      const buffer = await writeWorkbook([{ name: tipo, columns: report.columns, rows: report.rows }]);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="informe-${tipo}.xlsx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return ok({ tipo, desde, hasta, sucursal, ...report });
  });
}

async function build(tx: Tx, companyId: string, tipo: string, desde: string, hasta: string, sucursal: string) {
  const period = sql`d.issued_on between ${desde}::date and ${hasta}::date`;
  const depot = /^[0-9a-f-]{36}$/i.test(sucursal) ? sucursal : "";
  const branch = depot ? sql`and w.id = ${depot}::uuid` : sql``;
  if (tipo === "ventas" || tipo === "compras") {
    const kind = tipo === "ventas" ? "venta" : "compra";
    const rows = await tx.execute<{ party: string; payment: string; total: string; count: string }>(sql`
      select d.party_name as party, d.payment_method as payment, sum(d.total_cents * dt.sign)::text as total, count(*)::text as count
      from documents d
      join document_types dt on dt.id = d.document_type_id
      left join warehouses w on w.id = d.warehouse_id
      where d.company_id = ${companyId} and d.kind = ${kind} and d.status = 'confirmado' and ${period} ${branch}
      group by d.party_name, d.payment_method
      order by d.party_name
    `);
    return { columns: ["Cuenta", "Medio de pago", "Comprobantes", "Total"], rows: rows.map((row) => [row.party, paymentLabel(row.payment), row.count, money(row.total)]) };
  }
  if (tipo === "iva-ventas" || tipo === "iva-compras") {
    const kind = tipo === "iva-ventas" ? "venta" : "compra";
    const rows = await tx.execute<{ issued_on: string; letter: string | null; point_of_sale: number; number: number; supplier_pos: number | null; supplier_number: number | null; cuit: string | null; name: string; net: string; vat: string; exempt: string; untaxed: string; total: string }>(sql`
      select to_char(d.issued_on, 'DD/MM/YYYY') as issued_on, d.letter, d.point_of_sale, d.number,
        d.supplier_pos, d.supplier_number,
        d.party_cuit as cuit, d.party_name as name,
             d.net_taxed_cents::text as net, d.vat_cents::text as vat,
             d.exempt_cents::text as exempt, d.net_untaxed_cents::text as untaxed, d.total_cents::text as total
      from documents d
      where d.company_id = ${companyId} and d.kind = ${kind} and d.status = 'confirmado' and ${period}
      order by d.issued_on, d.number
    `);
    return {
      columns: ["Fecha", "Tipo", "Punto de venta", "Número", "CUIT", "Denominación", "Neto gravado", "IVA", "No gravado/Exento", "Total"],
      rows: rows.map((row) => {
        const supplier = kind === "compra" && row.supplier_number;
        const pos = supplier ? row.supplier_pos ?? 0 : row.point_of_sale;
        const number = supplier ? row.supplier_number ?? row.number : row.number;
        const exempt = Number(row.exempt) + Number(row.untaxed);
        const net = row.letter === "C" ? 0 : Number(row.net);
        const untaxed = row.letter === "C" && exempt === 0 ? Number(row.total) : exempt;
        return [row.issued_on, row.letter ?? "", String(pos).padStart(4, "0"), String(number).padStart(8, "0"), row.cuit ?? "", row.name, money(net), money(row.vat), money(untaxed), money(row.total)];
      }),
    };
  }
  if (tipo === "cuentas") {
    const rows = await tx.execute<{ name: string; kind: string; balance: string }>(sql`
      select p.name, 'cliente' as kind, coalesce(sum(e.debit_cents - e.credit_cents), 0)::text as balance
      from customers p left join current_account_entries e on e.party_id = p.id and e.party_type = 'customer'
      where p.company_id = ${companyId} group by p.name
      union all
      select p.name, 'proveedor', coalesce(sum(e.credit_cents - e.debit_cents), 0)::text
      from suppliers p left join current_account_entries e on e.party_id = p.id and e.party_type = 'supplier'
      where p.company_id = ${companyId} group by p.name
      order by 1
    `);
    return { columns: ["Cuenta", "Tipo", "Saldo"], rows: rows.map((row) => [row.name, row.kind === "cliente" ? "Cliente" : "Proveedor", money(row.balance)]) };
  }
  if (tipo === "antiguedad") {
    const rows = await tx.execute<{ party: string; party_kind: "cliente" | "proveedor"; occurred_on: string; debit_cents: string; credit_cents: string }>(sql`
      select coalesce(c.name, s.name, 'Sin nombre') as party,
             case when e.party_type = 'customer' then 'cliente' else 'proveedor' end as party_kind,
             e.occurred_on::text as occurred_on, e.debit_cents::text, e.credit_cents::text
      from current_account_entries e
      left join customers c on e.party_type = 'customer' and c.id = e.party_id
      left join suppliers s on e.party_type = 'supplier' and s.id = e.party_id
      left join documents d on d.id = e.document_id
      where e.company_id = ${companyId} and (d.id is null or d.kind <> 'remito')
    `);
    const aged = ageLedger(rows.map((row) => ({
      party: row.party,
      partyKind: row.party_kind,
      occurredOn: row.occurred_on,
      debitCents: Number(row.debit_cents),
      creditCents: Number(row.credit_cents),
    })), hasta);
    return {
      columns: ["Cuenta", "Tipo", "Antigüedad", "Importe"],
      rows: aged.map((row) => [row.party, row.partyKind === "cliente" ? "Cliente" : "Proveedor", row.bucket, money(String(row.cents))]),
    };
  }
  if (tipo === "stock") {
    const rows = await tx.execute<{ sku: string; name: string; deposito: string; quantity: string; cost: string }>(sql`
      select p.sku, p.name, w.name as deposito, s.quantity::text, (s.quantity * p.cost_cents)::text as cost
      from stock_levels s
      join products p on p.id = s.product_id
      join warehouses w on w.id = s.warehouse_id
      where s.company_id = ${companyId} ${depot ? sql`and w.id = ${depot}::uuid` : sql``}
      order by p.name
    `);
    return { columns: ["SKU", "Artículo", "Depósito", "Cantidad", "Valuación"], rows: rows.map((row) => [row.sku, row.name, row.deposito, qty(row.quantity), money(row.cost)]) };
  }
  if (tipo === "movimientos") {
    const rows = await tx.execute<{ sku: string; quantity: string; reason: string; created_at: string }>(sql`
      select p.sku, m.quantity::text, m.reason, to_char(m.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as created_at
      from stock_movements m join products p on p.id = m.product_id
      where m.company_id = ${companyId} and (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
      order by m.created_at desc limit 200
    `);
    return { columns: ["SKU", "Cantidad", "Motivo", "Fecha"], rows: rows.map((row) => [row.sku, qty(row.quantity), paymentLabel(row.reason), row.created_at]) };
  }
  if (tipo === "mermas") {
    const rows = await tx.execute<{ donde: string; liters: string }>(sql`
      select coalesce(t.name, tr.plate, 'Tanque') as donde, sum(e.liters)::text as liters
      from fuel_trip_events e
      left join fuel_tanks t on t.id = e.tank_id
      left join fuel_trips v on v.id = e.trip_id
      left join fuel_trucks tr on tr.id = v.truck_id
      where e.company_id = ${companyId} and e.kind = 'merma'
        and (e.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
      group by donde
    `);
    const tanks = await tx.execute<{ id: string; name: string }>(sql`select id::text, name from fuel_tanks where company_id = ${companyId}`);
    const sticks = await tx.execute<{ tank_id: string; measured_at: string; day: string; liters: string }>(sql`
      select tank_id::text, measured_at::text, (measured_at at time zone 'America/Argentina/Buenos_Aires')::date::text as day, liters::text
      from fuel_sticks where company_id = ${companyId} order by measured_at
    `);
    const deliveries = await tx.execute<{ tank_id: string; delivered_at: string; liters: string }>(sql`
      select tank_id::text, delivered_at::text, liters::text from fuel_deliveries where company_id = ${companyId}
    `);
    const sold = await tx.execute<{ tank_id: string; at: string; liters: string }>(sql`
      select n.tank_id::text, s.closed_at::text as at, r.liters::text
      from fuel_readings r join fuel_shifts s on s.id = r.shift_id join fuel_nozzles n on n.id = r.nozzle_id
      where r.company_id = ${companyId} and s.status = 'cerrado' and s.closed_at is not null
      union all
      select e.tank_id::text, e.occurred_at::text, (case when e.kind = 'carga' then e.liters else -e.liters end)::text
      from fuel_trip_events e
      where e.company_id = ${companyId} and e.kind in ('carga', 'retorno') and e.tank_id is not null
    `);
    const tankRows = tanks.flatMap((tank) => {
      const measures = sticks.filter((stick) => stick.tank_id === tank.id);
      const lines: string[][] = [];
      for (let index = 1; index < measures.length; index += 1) {
        const previous = measures[index - 1];
        const current = measures[index];
        if (!current || !previous || current.day < desde || current.day > hasta) continue;
        const ins = windowLiters(deliveries.filter((item) => item.tank_id === tank.id).map((item) => ({ at: item.delivered_at, liters: Number(item.liters) })), previous.measured_at, current.measured_at);
        const outs = windowLiters(sold.filter((item) => item.tank_id === tank.id).map((item) => ({ at: item.at, liters: Number(item.liters) })), previous.measured_at, current.measured_at);
        const shrinkage = reconcileTank({ previousStick: Number(previous.liters), deliveries: ins, sold: outs, currentStick: Number(current.liters) }).shrinkage;
        if (shrinkage > 0) lines.push([`${tank.name} (varilla ${current.day})`, qty(String(shrinkage))]);
      }
      return lines;
    });
    return { columns: ["Dónde", "Merma"], rows: [...rows.map((row) => [row.donde, qty(row.liters)]), ...tankRows] };
  }
  if (tipo === "caja") {
    const rows = await tx.execute<{ name: string; direction: string; total: string }>(sql`
      select a.name, m.direction, sum(m.amount_cents)::text as total
      from cash_movements m join cash_accounts a on a.id = m.cash_account_id
      where m.company_id = ${companyId} and m.occurred_on between ${desde}::date and ${hasta}::date
      group by a.name, m.direction order by a.name
    `);
    return { columns: ["Caja", "Sentido", "Total"], rows: rows.map((row) => [row.name, row.direction === "in" ? "Entra" : "Sale", money(row.total)]) };
  }
  if (tipo === "turnos") {
    const rows = await tx.execute<{ playero: string; unit: string; liters: string; amount: string }>(sql`
      select s.attendant_name as playero, fp.unit, coalesce(sum(r.liters), 0)::text as liters, coalesce(sum(r.amount_cents), 0)::text as amount
      from fuel_shifts s
      left join fuel_readings r on r.shift_id = s.id
      left join fuel_nozzles n on n.id = r.nozzle_id
      left join fuel_products fp on fp.id = n.product_id
      where s.company_id = ${companyId}
        and (
          (s.opened_at at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
          or (s.closed_at at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
        )
      group by s.attendant_name, fp.unit
      order by s.attendant_name, fp.unit
    `);
    return { columns: ["Playero", "Unidad", "Cantidad", "Vendido"], rows: rows.map((row) => [row.playero, unitLabel(row.unit), qty(row.liters), money(row.amount)]) };
  }
  if (tipo === "vales") {
    const rows = await tx.execute<{ customer: string; product: string; unit: string; liters: string; amount: string }>(sql`
      select c.name as customer, p.name as product, p.unit, sum(v.liters)::text as liters, sum(v.amount_cents)::text as amount
      from fleet_vouchers v join customers c on c.id = v.customer_id join fuel_products p on p.id = v.product_id
      where v.company_id = ${companyId} and v.issued_on between ${desde}::date and ${hasta}::date
      group by c.name, p.name, p.unit order by c.name
    `);
    return { columns: ["Cliente", "Producto", "Unidad", "Cantidad", "Importe"], rows: rows.map((row) => [row.customer, row.product, unitLabel(row.unit), qty(row.liters), money(row.amount)]) };
  }
  if (tipo === "reparto") {
    const rows = await tx.execute<{ truck: string; driver: string; liters: string; expenses: string; shrinkage: string }>(sql`
      select tr.plate as truck, t.driver_name as driver,
             coalesce(sum(e.liters) filter (where e.kind = 'entrega'), 0)::text as liters,
             coalesce(sum(e.amount_cents) filter (where e.kind = 'gasto'), 0)::text as expenses,
             coalesce(sum(e.liters) filter (where e.kind = 'merma'), 0)::text as shrinkage
      from fuel_trips t
      join fuel_trucks tr on tr.id = t.truck_id
      left join fuel_trip_events e on e.trip_id = t.id
      where t.company_id = ${companyId}
        and (
          t.status = 'abierto'
          or (coalesce(t.closed_at, t.opened_at) at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
          or exists (
            select 1 from fuel_trip_events ev
            where ev.trip_id = t.id
              and (ev.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between ${desde}::date and ${hasta}::date
          )
        )
      group by tr.plate, t.driver_name
      order by tr.plate
    `);
    return { columns: ["Camión", "Chofer", "Entregado", "Gastos", "Merma"], rows: rows.map((row) => [row.truck, row.driver, qty(row.liters), money(row.expenses), qty(row.shrinkage)]) };
  }
  const rows = await tx.execute<{ name: string; qty: string; sales: string; cost: string | null }>(sql`
    select l.description as name, sum(l.quantity)::text as qty, sum(l.net_cents)::text as sales,
      case when count(*) filter (where cost.unit_cents is null) > 0 then null
           else sum(l.quantity * cost.unit_cents)::text end as cost
    from document_lines l
    join documents d on d.id = l.document_id
    left join products p on p.id = l.product_id
    left join lateral (
      select coalesce(
        nullif(p.cost_cents, 0),
        (select dl.unit_price_cents from document_lines dl join documents c on c.id = dl.document_id
          where c.company_id = d.company_id and c.kind = 'compra' and c.status = 'confirmado' and lower(dl.description) = lower(l.description)
          order by c.issued_on desc limit 1)
      ) as unit_cents
    ) cost on true
    where d.company_id = ${companyId} and d.kind = 'venta' and d.status = 'confirmado' and ${period}
    group by l.description
    order by l.description
  `);
  return {
    columns: ["Artículo", "Cantidad", "Venta neta", "Costo", "Resultado"],
    rows: rows.map((row) => {
      const unknown = row.cost == null;
      return [row.name, qty(row.qty), money(row.sales), unknown ? "sin costo" : money(row.cost ?? "0"), unknown ? "sin costo" : money(String(Number(row.sales) - Number(row.cost)))];
    }),
  };
}

function qty(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? formatQty(amount) : value;
}

function unitLabel(unit: string | null): string {
  if (!unit) return "s/u";
  if (unit === "m3") return "m³";
  if (unit === "litro") return "litros";
  return unit;
}

function money(cents: string | number): string {
  return (Number(cents) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
