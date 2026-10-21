"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import {
  formatMoney,
  formatDate,
  parseMoneyToCents,
  parseLocaleNumber,
  todayIso,
} from "@/lib/format";
import { useMe, useCatalog } from "@/components/use-me";
import { EntryForm, type Field } from "@/components/business-entry-form";
import { Button } from "@/components/ui/button";
import { CertificateForm } from "./certificate-form";
const BusinessReversalPanel=dynamic(()=>import("@/components/business-reversal-panel").then(m=>m.BusinessReversalPanel));
type Row = Record<string, string | number | boolean | null>;
const tabs = {
  obras: "Obras",
  items: "Presupuesto",
  certificados: "Certificados",
  costos: "Costos",
  acopio: "Acopio",
  subcontratos: "Subcontratos",
  unidades: "Unidades / lotes",
  cuotas: "Cuotas",
  informes: "Informes",
} as const;
const amount = (value?: string) => {
  const parsed = parseMoneyToCents(value ?? "0");
  if (parsed === null) throw Error("Revisá los importes");
  return parsed;
};
const decimal = (value?: string) => {
  const parsed = parseLocaleNumber(value ?? "");
  if (parsed === null) throw Error("Revisá los números");
  return parsed;
};
export function ConstructoraScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const cache = useQueryClient();
  const [tab, setTab] = useState<keyof typeof tabs>("obras");
  const [workId, setWork] = useState("");
  const [mode, setMode] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const scope = me.data?.company.id;
  const works = useQuery({
    queryKey: ["construction", scope, "obras"],
    enabled: !!scope,
    queryFn: () => apiGet<{ items: Row[] }>("/api/constructora/obras"),
  });
  const current = works.data?.items.find((w) => w.id === workId);
  const result = useQuery({
    queryKey: ["construction", scope, tab, workId],
    enabled: !!scope && tab !== "obras" && (tab !== "items" || !!workId),
    queryFn: () =>
      apiGet<{ items: Row[] }>(
        `/api/constructora/${tab}${workId ? `?workId=${workId}` : ""}`,
      ),
  });
  const items = useQuery({
    queryKey: ["construction-budget", scope, workId],
    enabled: !!scope && !!workId && mode === "certificate",
    queryFn: () =>
      apiGet<{ items: Row[] }>(`/api/constructora/items?workId=${workId}`),
  });
  const create = !!me.data && can(me.data.permissions, "constructora", "crear");
  const edit = !!me.data && can(me.data.permissions, "constructora", "editar");
  function open(next: string, row?: Row) {
    if (!workId && next !== "work" && !row) {
      toast.error("Elegí una obra");
      return;
    }
    setSelected(row ?? null);
    setMode(next);
  }
  async function refresh() {
    setMode("");
    await cache.invalidateQueries({ queryKey: ["construction"] });
    await cache.invalidateQueries({ queryKey: ["construction-budget"] });
    await cache.invalidateQueries({ queryKey: ["catalogos"] });
  }
  const fields: Field[] = [];
  let title = "";
  let endpoint = "";
  let method = "POST";
  let map: (values: Record<string, string>) => unknown = (v) => v;
  const cashField: Field = {
    key: "cashAccountId",
    label: "Caja",
    options: (catalog.data?.cashAccounts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
    })),
  };
  const when: Field = { key: "occurredOn", label: "Fecha", type: "date" };
  if (mode === "work") {
    title = "Nueva obra";
    endpoint = "obras";
    fields.push(
      { key: "name", label: "Obra / proyecto" },
      { key: "customerId", label: "Cliente", party: "clientes" },
      { key: "location", label: "Ubicación" },
      { key: "responsible", label: "Responsable" },
      { key: "startsOn", label: "Inicio", type: "date" },
      { key: "endsOn", label: "Fin previsto", type: "date" },
      {
        key: "repairBps",
        label: "Fondo de reparo (%)",
        type: "rate",
        initial: "5",
      },
      {
        key: "vatBps",
        label: "IVA",
        options: [
          { id: "0", name: "Sin IVA" },
          { id: "1050", name: "10,5%" },
          { id: "2100", name: "21%" },
          { id: "2700", name: "27%" },
        ],
        initial: me.data?.company.taxCondition === "ri" ? "2100" : "0",
      },
      { key: "cacBaseMonth", label: "Mes base CAC (opcional)", type: "month" },
      { key: "cacBaseIndex", label: "Índice base CAC (opcional)" },
      {
        key: "cacLagMonths",
        label: "Meses de rezago del índice",
        type: "number",
        initial: "0",
      },
    );
    map = (v) => ({
      ...v,
      repairBps: amount(v.repairBps),
      vatBps: Number(v.vatBps),
      cacBaseMonth: v.cacBaseMonth || undefined,
      cacBaseIndex: v.cacBaseIndex ? decimal(v.cacBaseIndex) : undefined,
      cacLagMonths: Number(v.cacLagMonths),
    });
  } else if (mode === "item" || mode === "edit-item") {
    title = "Ítem de presupuesto / ampliación";
    endpoint = "items";
    fields.push(
      { key: "rubro", label: "Rubro" },
      { key: "description", label: "Ítem" },
      {
        key: "kind",
        label: "Tipo",
        options: [
          { id: "material", name: "Materiales" },
          { id: "mano_obra", name: "Mano de obra" },
          { id: "subcontrato", name: "Subcontrato" },
        ],
      },
      { key: "quantity", label: "Cantidad pactada", initial: "1" },
      {
        key: "unitPriceCents",
        label: "Precio unitario neto ($)",
        type: "money",
      },
      {
        key: "global",
        label: "Ítem global (cantidad 1, avance %)",
        options: [
          { id: "no", name: "No" },
          { id: "si", name: "Sí" },
        ],
        initial: "no",
      },
      {
        key: "additional",
        label: "Adicional o ampliación",
        options: [
          { id: "no", name: "No" },
          { id: "si", name: "Sí" },
        ],
        initial: Number(current?.certified_cents) > 0 ? "si" : "no",
      },
    );
    map = (v) => ({
      ...v,
      workId,
      quantity: decimal(v.quantity),
      unitPriceCents: amount(v.unitPriceCents),
      global: v.global === "si",
      additional: v.additional === "si",
    });
    if (mode === "edit-item") {
      endpoint = `items/${selected?.id}`;
      method = "PATCH";
      for (const field of fields) {
        if (field.key === "quantity")
          field.initial = String(Number(selected?.quantity_milli) / 1000);
        else if (field.key === "unitPriceCents")
          field.initial = String(Number(selected?.unit_price_cents) / 100);
        else if (field.key === "global")
          field.initial = selected?.global_item ? "si" : "no";
        else if (field.key === "additional")
          field.initial = selected?.additional ? "si" : "no";
        else field.initial = String(selected?.[field.key] ?? "");
      }
    }
  } else if (mode === "advance") {
    title = "Anticipo financiero previo al primer certificado";
    endpoint = "anticipos";
    fields.push(
      {
        key: "amountCents",
        label: "Anticipo neto ($), más IVA en factura",
        type: "money",
      },
      cashField,
      when,
    );
    map = (v) => ({ ...v, workId, amountCents: amount(v.amountCents) });
  } else if (mode === "collect") {
    title = "Cobrar neto facturado del certificado";
    endpoint = `certificados/${selected?.id}/cobrar`;
    fields.push(
      {
        key: "amountCents",
        label: "Importe ($)",
        type: "money",
        initial: String(
          (Number(selected?.total_cents) -
            Number(selected?.paid_cents) -
            (selected?.repair_released ? 0 : Number(selected?.repair_cents))) /
            100,
        ),
      },
      cashField,
      when,
    );
    map = (v) => ({ ...v, amountCents: amount(v.amountCents) });
  } else if (mode === "cost") {
    title = "Imputar costo real (no mueve caja)";
    endpoint = "costos";
    fields.push(
      {
        key: "kind",
        label: "Tipo",
        options: ["material", "mano_obra", "subcontrato", "gasto"].map(
          (id) => ({ id, name: id }),
        ),
      },
      { key: "description", label: "Descripción" },
      { key: "amountCents", label: "Costo imputado ($)", type: "money" },
      {
        key: "purchaseId",
        label: "Compra existente (opcional)",
        lookup: "compras",
      },
      when,
    );
    map = (v) => ({
      ...v,
      workId,
      amountCents: amount(v.amountCents),
      purchaseId: v.purchaseId || undefined,
    });
  } else if (mode === "subcontract") {
    title = "Nuevo subcontrato";
    endpoint = "subcontratos";
    fields.push(
      { key: "supplierId", label: "Subcontratista", party: "proveedores" },
      { key: "description", label: "Descripción" },
      { key: "amountCents", label: "Importe contratado ($)", type: "money" },
      { key: "retentionBps", label: "Retención contractual (%)", type: "rate" },
    );
    map = (v) => ({
      ...v,
      workId,
      amountCents: amount(v.amountCents),
      retentionBps: amount(v.retentionBps),
    });
  } else if (mode === "subcertificate") {
    title = "Certificar subcontrato como costo";
    endpoint = `subcontratos/${selected?.id}/certificar`;
    fields.push(
      {
        key: "period",
        label: "Período",
        type: "month",
        initial: todayIso().slice(0, 7),
      },
      { key: "amountCents", label: "Importe del período ($)", type: "money" },
      when,
    );
    map = (v) => ({ ...v, amountCents: amount(v.amountCents) });
  } else if (mode === "transfer") {
    title = "Remito y transferencia de materiales a obra";
    endpoint = "acopio";
    fields.push(
      { key: "productId", label: "Artículo con stock", lookup: "articulos" },
      {
        key: "fromWarehouseId",
        label: "Depósito de origen",
        options: (catalog.data?.warehouses ?? [])
          .filter((w) => w.id !== current?.warehouse_id)
          .map((w) => ({ id: w.id, name: w.name })),
      },
      { key: "quantity", label: "Cantidad" },
      when,
    );
    map = (v) => ({ ...v, workId, quantity: decimal(v.quantity) });
  } else if (mode === "unit") {
    title = "Nueva unidad / lote";
    endpoint = "unidades";
    fields.push(
      { key: "name", label: "Unidad o lote" },
      { key: "priceCents", label: "Precio ($)", type: "money" },
    );
    map = (v) => ({ ...v, workId, priceCents: amount(v.priceCents) });
  } else if (mode === "sell") {
    title = "Venta contractual y plan de cuotas";
    endpoint = `unidades/${selected?.id}/vender`;
    fields.push(
      { key: "buyerId", label: "Comprador", party: "clientes" },
      {
        key: "priceCents",
        label: "Precio final pactado ($)",
        type: "money",
        initial: String(Number(selected?.price_cents) / 100),
      },
      {
        key: "installments",
        label: "Cantidad de cuotas",
        type: "number",
        initial: "12",
      },
      { key: "firstDueOn", label: "Primer vencimiento", type: "date" },
      {
        key: "adjustmentMethod",
        label: "Ajuste de cuotas",
        options: ["sin_ajuste", "manual", "fijo", "CAC"].map((id) => ({
          id,
          name: id,
        })),
        initial: "sin_ajuste",
      },
      { key: "fixedBps", label: "Ajuste fijo (%)", type: "rate" },
    );
    map = (v) => ({
      ...v,
      priceCents: amount(v.priceCents),
      installments: Number(v.installments),
      fixedBps: amount(v.fixedBps),
    });
  } else if (mode === "installment") {
    title = "Cobrar cuota";
    endpoint = `cuotas/${selected?.id}/cobrar`;
    fields.push(
      {
        key: "amountCents",
        label: "Importe ($)",
        type: "money",
        initial: String(
          (Number(selected?.amount_cents) - Number(selected?.paid_cents)) / 100,
        ),
      },
      cashField,
      when,
    );
    map = (v) => ({ ...v, amountCents: amount(v.amountCents) });
  } else if (mode === "adjust") {
    title = "Ajustar saldo pendiente de cuota";
    endpoint = `cuotas/${selected?.id}/ajustar`;
    fields.push(
      { key: "coefficient", label: "Coeficiente CAC (ejemplo 1.15)" },
      {
        key: "newAmountCents",
        label: "Nuevo saldo pendiente ($, ajuste manual)",
        type: "money",
      },
      { key: "source", label: "Fuente y referencia" },
      when,
    );
    map = (v) => ({
      ...v,
      coefficient: v.coefficient ? decimal(v.coefficient) : undefined,
      newAmountCents:
        v.newAmountCents && amount(v.newAmountCents) > 0
          ? amount(v.newAmountCents)
          : undefined,
    });
  } else if (mode === "status") {
    title = "Estado de obra";
    endpoint = `obras/${selected?.id}`;
    method = "PATCH";
    fields.push({
      key: "status",
      label: "Estado",
      options: ["planificada", "activa", "pausada", "finalizada"].map((id) => ({
        id,
        name: id,
      })),
      initial: String(selected?.status),
    });
  }
  const data = tab === "obras" ? works.data?.items : result.data?.items;
  const report = result.data as unknown as
    | {
        works: Row[];
        costs: Row[];
        certificates: Row[];
        advances: Row[];
        units: Row[];
      }
    | undefined;
  return (
    <main className="grid gap-4 p-4 md:p-6">
      {me.data && can(me.data.permissions,"constructora","anular") ? <BusinessReversalPanel sector="constructora" /> : null}
      <div>
        <h1 className="text-2xl font-semibold">Constructora</h1>
        <p className="text-sm text-muted-foreground">
          Presupuesto por ítems, certificados por cantidades, costos reales,
          acopio y cuotas.
        </p>
      </div>
      <label className="grid max-w-xl gap-1 text-sm">
        Obra seleccionada
        <select
          aria-label="Obra seleccionada"
          className="h-8 rounded border px-2"
          value={workId}
          onChange={(e) => {
            setWork(e.target.value);
            setMode("");
          }}
        >
          <option value="">Todas las obras / elegir una para operar</option>
          {works.data?.items.map((w) => (
            <option key={String(w.id)} value={String(w.id)}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <nav
        className="flex flex-wrap gap-1"
        aria-label="Secciones de constructora"
      >
        {Object.entries(tabs).map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            onClick={() => {
              setTab(key as keyof typeof tabs);
              setMode("");
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      {works.error || result.error ? (
        <p role="alert">{(works.error ?? result.error)?.message}</p>
      ) : null}
      {create ? (
        <div className="flex flex-wrap gap-2">
          {tab === "obras" ? (
            <Button onClick={() => open("work")}>Nueva obra</Button>
          ) : null}
          {tab === "items" && workId ? (
            <Button onClick={() => open("item")}>
              Agregar ítem / ampliación
            </Button>
          ) : null}
          {tab === "certificados" && workId ? (
            <>
              <Button onClick={() => open("certificate")}>
                Nuevo certificado
              </Button>
              <Button variant="outline" onClick={() => open("advance")}>
                Registrar anticipo
              </Button>
            </>
          ) : null}
          {tab === "costos" && workId ? (
            <Button onClick={() => open("cost")}>Imputar costo</Button>
          ) : null}
          {tab === "acopio" && workId ? (
            <Button onClick={() => open("transfer")}>Remitir a obra</Button>
          ) : null}
          {tab === "subcontratos" && workId ? (
            <Button onClick={() => open("subcontract")}>
              Nuevo subcontrato
            </Button>
          ) : null}
          {tab === "unidades" && workId ? (
            <Button onClick={() => open("unit")}>Nueva unidad / lote</Button>
          ) : null}
        </div>
      ) : null}
      {fields.length ? (
        <EntryForm
          key={`${mode}-${selected?.id ?? workId}`}
          title={title}
          fields={fields}
          onCancel={() => setMode("")}
          onSave={async (v) => {
            await apiSend(`/api/constructora/${endpoint}`, method, map(v));
            toast.success("Operación guardada");
            await refresh();
          }}
        />
      ) : null}
      {mode === "certificate" && current && items.data ? (
        <CertificateForm
          key={workId}
          work={current}
          items={items.data.items}
          onDone={refresh}
          onCancel={() => setMode("")}
        />
      ) : null}
      {tab === "items" && !workId ? (
        <p>Elegí una obra para ver el presupuesto.</p>
      ) : null}
      {tab === "informes" && report ? (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Obra</th>
                <th>Presupuesto</th>
                <th>Costo real</th>
                <th>Desvío</th>
                <th>Básico + CAC (sin IVA)</th>
                <th>Resultado sobre costos</th>
                <th>Certificados / cobrado</th>
                <th>Cuotas pendientes</th>
                <th>Anticipo pendiente</th>
                <th>Fondo de reparo</th>
              </tr>
            </thead>
            <tbody>
              {report.works?.map((w) => {
                const cost = (report.costs ?? [])
                  .filter((c) => c.work_id === w.id)
                  .reduce((sum, c) => sum + Number(c.amount_cents), 0);
                const c = report.certificates?.find((c) => c.work_id === w.id);
                const units = report.units?.find((c) => c.work_id === w.id);
                const advance = report.advances?.find((a) => a.id === w.id);
                return (
                  <tr key={String(w.id)} className="border-b">
                    <td className="p-2">{w.name}</td>
                    <td className="p-2 text-right">
                      {formatMoney(Number(w.budget_cents))}
                    </td>
                    <td className="p-2 text-right">{formatMoney(cost)}</td>
                    <td className="p-2 text-right">
                      {formatMoney(cost - Number(w.budget_cents))}
                    </td>
                    <td className="p-2 text-right">
                      {formatMoney(Number(c?.earned_cents ?? 0))}
                    </td>
                    <td className="p-2 text-right">
                      {formatMoney(Number(c?.earned_cents ?? 0) - cost)}
                    </td>
                    <td className="p-2 text-right">
                      {formatMoney(Number(c?.invoiced_cents ?? 0))} /{" "}
                      {formatMoney(Number(c?.paid_cents ?? 0))}
                    </td>
                    <td className="p-2 text-right">
                      {formatMoney(Number(units?.pending_cents ?? 0))}
                      <span className="block text-xs">
                        Vencido:{" "}
                        {formatMoney(Number(units?.overdue_cents ?? 0))}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      {formatMoney(
                        Number(advance?.advance_cents ?? 0) -
                          Number(advance?.recovered_cents ?? 0),
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {advance?.repair_release_id
                        ? "Habilitado para cobro"
                        : formatMoney(Number(c?.retained_cents ?? 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab !== "informes" ? (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="p-2">Referencia</th>
                <th className="p-2">Detalle</th>
                <th className="p-2 text-right">Importe / cantidad</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r, i) => (
                <tr className="border-b" key={String(r.id ?? `${r.sku}-${i}`)}>
                  <td className="p-2">
                    {r.name ?? r.description ?? r.unit_name ?? r.work_name}
                    <span className="block text-xs text-muted-foreground">
                      {r.rubro ??
                        r.buyer_name ??
                        r.customer_name ??
                        r.supplier_name}
                    </span>
                  </td>
                  <td className="p-2">
                    {tab === "items"
                      ? `${r.global_item ? "Global" : Number(r.quantity_milli) / 1000} · ${r.kind}${r.additional ? " · Adicional" : ""}`
                      : tab === "cuotas"
                        ? `Cuota ${r.number} · ${formatDate(String(r.due_on))}`
                        : (r.period ?? r.status ?? r.kind ?? r.sku)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {tab === "acopio"
                      ? Number(r.quantity)
                      : formatMoney(
                          Number(
                            r.total_cents ??
                              r.amount_cents ??
                              r.price_cents ??
                              r.budget_cents ??
                              r.unit_price_cents ??
                              0,
                          ),
                        )}
                    {tab === "certificados" ? (
                      <span className="block text-xs">
                        Cobrado {formatMoney(Number(r.paid_cents))} · avance
                        informativo {Number(r.progress_bps) / 100}%
                      </span>
                    ) : null}
                    {tab === "obras" ? (
                      <span className="block text-xs">
                        Avance informativo:{" "}
                        {Number(r.budget_cents) > 0
                          ? (
                              (Number(r.certified_cents) /
                                Number(r.budget_cents)) *
                              100
                            ).toLocaleString("es-AR", {
                              maximumFractionDigits: 2,
                            })
                          : 0}
                        %
                      </span>
                    ) : null}
                    {tab === "subcontratos" ? (
                      <span className="block text-xs">
                        Certificado {formatMoney(Number(r.certified_cents))} ·
                        retenido {formatMoney(Number(r.retained_cents))}
                      </span>
                    ) : null}
                    {tab === "cuotas" ? (
                      <span className="block text-xs">
                        Pendiente{" "}
                        {formatMoney(
                          Number(r.amount_cents) - Number(r.paid_cents),
                        )}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {tab === "obras" ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setWork(String(r.id));
                            setTab("items");
                          }}
                        >
                          Abrir
                        </Button>
                      ) : null}
                      {tab === "obras" && edit ? (
                        <Button
                          variant="outline"
                          onClick={() => open("status", r)}
                        >
                          Estado
                        </Button>
                      ) : null}
                      {tab === "obras" &&
                      create &&
                      r.status === "finalizada" ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await apiSend(
                                `/api/constructora/obras/${r.id}/liberar-reparo`,
                                "POST",
                                { occurredOn: todayIso() },
                              );
                              toast.success(
                                "Fondo de reparo habilitado para cobro",
                              );
                              await refresh();
                            } catch (e) {
                              toast.error(
                                e instanceof Error
                                  ? e.message
                                  : "No se pudo liberar",
                              );
                            }
                          }}
                        >
                          Liberar reparo
                        </Button>
                      ) : null}
                      {tab === "items" && edit ? (
                        <Button
                          variant="outline"
                          onClick={() => open("edit-item", r)}
                        >
                          Editar
                        </Button>
                      ) : null}
                      {tab === "items" &&
                      me.data &&
                      can(me.data.permissions, "constructora", "anular") ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "¿Quitar este ítem sin certificar?",
                              )
                            )
                              return;
                            try {
                              await apiSend(
                                `/api/constructora/items/${r.id}`,
                                "DELETE",
                              );
                              await refresh();
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "No se pudo quitar",
                              );
                            }
                          }}
                        >
                          Quitar
                        </Button>
                      ) : null}
                      {tab === "certificados" ? (
                        <>
                          <a
                            className="text-primary underline"
                            href={`/constructora/${r.id}/certificado`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Detalle / imprimir
                          </a>
                          <a
                            className="text-primary underline"
                            href={`/ventas/${r.invoice_id}`}
                          >
                            Factura
                          </a>
                          {create ? (
                            <Button
                              variant="outline"
                              onClick={() => open("collect", r)}
                            >
                              Cobrar
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {tab === "subcontratos" && create ? (
                        <Button
                          variant="outline"
                          onClick={() => open("subcertificate", r)}
                        >
                          Certificar
                        </Button>
                      ) : null}
                      {tab === "unidades" &&
                      create &&
                      r.status === "disponible" ? (
                        <Button
                          variant="outline"
                          onClick={() => open("sell", r)}
                        >
                          Vender en cuotas
                        </Button>
                      ) : null}
                      {tab === "cuotas" && create ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => open("installment", r)}
                          >
                            Cobrar
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => open("adjust", r)}
                          >
                            Ajustar saldo
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(tab === "obras" ? works.isPending : result.isPending) ? (
            <p className="p-3 text-sm">Cargando…</p>
          ) : !data?.length ? (
            <p className="p-3 text-sm">Sin registros.</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        CAC requiere índice y fuente cargados. Los costos y subcertificados no
        pagan ni reemplazan facturas de proveedores. Las ventas en cuotas
        registran el contrato y su cuenta corriente; la escrituración y factura
        fiscal de la unidad se gestionan por separado. Se muestran hasta 100
        registros por sección.
      </p>
    </main>
  );
}
