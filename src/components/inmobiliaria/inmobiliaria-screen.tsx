"use client";
import dynamic from "next/dynamic";
import { EntryForm, type Field } from "@/components/business-entry-form";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { addMonths } from "@/lib/estate-rules";
import {
  formatMoney,
  formatDate,
  parseMoneyToCents,
  todayIso,
} from "@/lib/format";
import { useMe, useCatalog } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BusinessReversalPanel=dynamic(()=>import("@/components/business-reversal-panel").then(m=>m.BusinessReversalPanel));
type Row = Record<string, string | number | null>;
const tabs = {
  resumen: "Resumen",
  propiedades: "Propiedades",
  contratos: "Contratos",
  liquidaciones: "Alquileres",
  cobros: "Cobros",
  propietarios: "Liquidaciones al propietario",
  ventas: "Ventas de propiedades",
} as const;
const money = (value?: string) => {
  const cents = parseMoneyToCents(value ?? "0");
  if (cents === null) throw Error("Revisá los importes");
  return cents;
};
const percent = (value?: string) => {
  const bps = money(value);
  if (bps < 0) throw Error("La tasa no puede ser negativa");
  return bps;
};
const number = (value?: string) => Number(value);
const options = (items: Row[] | undefined, label: string) =>
  (items ?? []).map((item) => ({
    id: String(item.id),
    name: String(item[label] ?? item.id),
  }));
export function InmobiliariaScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const cache = useQueryClient();
  const [tab, setTab] = useState<keyof typeof tabs>("resumen");
  const [mode, setMode] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const scope = me.data?.company.id;
  const rows = useQuery({
    queryKey: ["estate", scope, tab, term],
    enabled: !!scope,
    queryFn: () =>
      apiGet<{ items: Row[] }>(
        `/api/inmobiliaria/${tab}${tab === "propiedades" ? `?q=${encodeURIComponent(term)}&pageSize=100` : ""}`,
      ),
  });
  const summary = rows.data as unknown as
    | {
        properties: { status: string; count: number }[];
        alerts: Row[];
        late: Row[];
        settlements: { pending_cents: string; commission_cents: string };
      }
    | undefined;
  const props = useQuery({
    queryKey: ["estate-options", scope, "properties"],
    enabled: !!scope && (mode === "contract" || mode === "sale"),
    queryFn: () =>
      apiGet<{ items: Row[] }>("/api/inmobiliaria/propiedades?pageSize=100"),
  });
  const contracts = useQuery({
    queryKey: ["estate-options", scope, "contracts"],
    enabled: !!scope && mode === "charge",
    queryFn: () => apiGet<{ items: Row[] }>("/api/inmobiliaria/contratos"),
  });
  const attachments = useQuery({
    queryKey: ["estate-files", scope, selected?.id],
    enabled: !!scope && mode === "attachments" && !!selected,
    queryFn: () =>
      apiGet<{ items: { id: string; filename: string }[] }>(
        `/api/inmobiliaria/adjuntos?propertyId=${selected?.id}`,
      ),
  });
  const create = !!me.data && can(me.data.permissions, "inmobiliaria", "crear");
  const edit = !!me.data && can(me.data.permissions, "inmobiliaria", "editar");
  const cashOptions = (catalog.data?.cashAccounts ?? []).map((item) => ({
    id: item.id,
    name: item.name,
  }));
  function open(next: string, row?: Row) {
    setSelected(row ?? null);
    setMode(next);
  }
  const fields: Field[] = [];
  let title = "";
  let endpoint = "";
  let method = "POST";
  let map: (v: Record<string, string>) => unknown = (v) => v;
  const cashField: Field = {
    key: "cashAccountId",
    label: "Caja",
    options: cashOptions,
  };
  const when: Field = { key: "occurredOn", label: "Fecha", type: "date" };
  const vatField: Field = {
    key: "commissionVatBps",
    label: "IVA de la comisión",
    options: [
      { id: "0", name: "Sin IVA" },
      { id: "1050", name: "10,5%" },
      { id: "2100", name: "21%" },
      { id: "2700", name: "27%" },
    ],
    initial: "0",
  };
  if (mode === "property" || mode === "edit-property") {
    title = mode === "property" ? "Nueva propiedad" : "Editar propiedad";
    endpoint =
      mode === "property" ? "propiedades" : `propiedades/${selected?.id}`;
    if (mode === "edit-property") {
      method = "PATCH";
      map = (v) => ({ ...v, status: selected?.status });
    }
    fields.push(
      { key: "address", label: "Dirección" },
      {
        key: "kind",
        label: "Tipo",
        options: ["casa", "depto", "local", "lote"].map((id) => ({
          id,
          name: id,
        })),
      },
      {
        key: "ownerCustomerId",
        label: "Propietario · ficha de cliente",
        party: "clientes",
      },
      {
        key: "ownerSupplierId",
        label: "Propietario · ficha de proveedor",
        party: "proveedores",
      },
      { key: "notes", label: "Notas" },
    );
    if (mode === "edit-property")
      for (const field of fields)
        field.initial = String(
          selected?.[
            (
              {
                ownerCustomerId: "owner_customer_id",
                ownerSupplierId: "owner_supplier_id",
              } as Record<string, string>
            )[field.key] ?? field.key
          ] ?? "",
        );
  } else if (mode === "contract") {
    title = "Nuevo contrato";
    endpoint = "contratos";
    fields.push(
      {
        key: "propertyId",
        label: "Propiedad disponible",
        options: options(
          props.data?.items.filter((p) => p.status === "disponible"),
          "address",
        ),
      },
      { key: "tenantId", label: "Inquilino", party: "clientes" },
      { key: "startsOn", label: "Inicio", type: "date" },
      { key: "endsOn", label: "Fin", type: "date" },
      { key: "initialRentCents", label: "Alquiler inicial ($)", type: "money" },
      {
        key: "depositCents",
        label: "Depósito pactado ($, no registra cobro)",
        type: "money",
      },
      {
        key: "dueDay",
        label: "Día de vencimiento (1 a 28)",
        type: "number",
        initial: "10",
      },
      {
        key: "adjustmentMethod",
        label: "Ajuste",
        options: ["manual", "fijo", "ICL", "IPC"].map((id) => ({
          id,
          name: id,
        })),
        initial: "manual",
      },
      {
        key: "adjustmentMonths",
        label: "Período de ajuste (meses)",
        type: "number",
        initial: "3",
      },
      { key: "fixedAdjustmentBps", label: "Ajuste fijo (%)", type: "rate" },
      {
        key: "commissionBps",
        label: "Comisión sobre alquiler cobrado (%)",
        type: "rate",
      },
      vatField,
      {
        key: "lateDailyBps",
        label: "Punitorio diario simple (%)",
        type: "rate",
      },
      {
        key: "graceDays",
        label: "Días de gracia",
        type: "number",
        initial: "0",
      },
      { key: "guarantors", label: "Garantes (separar con punto y coma)" },
    );
    map = (v) => ({
      ...v,
      initialRentCents: money(v.initialRentCents),
      depositCents: money(v.depositCents),
      dueDay: number(v.dueDay),
      adjustmentMonths: number(v.adjustmentMonths),
      fixedAdjustmentBps: percent(v.fixedAdjustmentBps),
      commissionBps: percent(v.commissionBps),
      commissionVatBps: number(v.commissionVatBps),
      lateDailyBps: percent(v.lateDailyBps),
      graceDays: number(v.graceDays),
      guarantors: v.guarantors
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean),
    });
  } else if (mode === "conditions") {
    title = "Condiciones para nuevos cobros y liquidaciones";
    endpoint = `contratos/${selected?.id}/condiciones`;
    method = "PATCH";
    fields.push(
      {
        key: "commissionBps",
        label: "Comisión sobre alquiler cobrado (%)",
        type: "rate",
        initial: String(Number(selected?.commission_bps) / 100),
      },
      vatField,
      {
        key: "lateDailyBps",
        label: "Punitorio diario simple (%)",
        type: "rate",
        initial: String(Number(selected?.late_daily_bps) / 100),
      },
      {
        key: "graceDays",
        label: "Días de gracia",
        type: "number",
        initial: String(selected?.grace_days),
      },
    );
    vatField.initial = String(selected?.commission_vat_bps);
    map = (v) => ({
      commissionBps: percent(v.commissionBps),
      commissionVatBps: number(v.commissionVatBps),
      lateDailyBps: percent(v.lateDailyBps),
      graceDays: number(v.graceDays),
    });
  } else if (mode === "adjust") {
    title = `Ajustar · ${selected?.address}`;
    endpoint = `contratos/${selected?.id}/ajustar`;
    fields.push(
      {
        key: "effectiveOn",
        label: "Vigencia (primer día del mes)",
        type: "date",
      },
      {
        key: "newRentCents",
        label: "Nuevo alquiler ($, método manual)",
        type: "money",
      },
      { key: "coefficient", label: "Coeficiente ICL/IPC (ejemplo 1.15)" },
      { key: "source", label: "Fuente y referencia del ajuste" },
    );
    map = (v) => ({
      ...v,
      newRentCents: money(v.newRentCents),
      coefficient: v.coefficient
        ? Number(v.coefficient.replace(",", "."))
        : undefined,
    });
  } else if (mode === "charge") {
    title = "Liquidar alquiler mensual";
    endpoint = "liquidaciones";
    fields.push(
      {
        key: "contractId",
        label: "Contrato",
        options: options(contracts.data?.items, "address"),
      },
      {
        key: "period",
        label: "Período",
        type: "month",
        initial: todayIso().slice(0, 7),
      },
      {
        key: "expensesCents",
        label: "Expensas a cargo del inquilino ($)",
        type: "money",
      },
      { key: "taxesCents", label: "Impuestos a cargo ($)", type: "money" },
      { key: "servicesCents", label: "Servicios a cargo ($)", type: "money" },
      { key: "asOf", label: "Calcular mora hasta", type: "date" },
      { key: "notes", label: "Notas" },
    );
    map = (v) => ({
      ...v,
      expensesCents: money(v.expensesCents),
      taxesCents: money(v.taxesCents),
      servicesCents: money(v.servicesCents),
    });
  } else if (mode === "collect") {
    title = `Cobrar · ${selected?.address} · ${selected?.period}`;
    endpoint = `liquidaciones/${selected?.id}/cobrar`;
    fields.push(
      {
        key: "rentCents",
        label: "Cobro aplicado a alquiler ($)",
        type: "money",
        initial: String(
          (Number(selected?.rent_cents) - Number(selected?.rent_paid_cents)) /
            100,
        ),
      },
      {
        key: "extrasCents",
        label: "Cobro aplicado a adicionales ($)",
        type: "money",
        initial: String(
          (Number(selected?.extras_cents) -
            Number(selected?.extras_paid_cents)) /
            100,
        ),
      },
      cashField,
      when,
    );
    map = (v) => ({
      ...v,
      rentCents: money(v.rentCents),
      extrasCents: money(v.extrasCents),
    });
  } else if (mode === "settle") {
    title = "Liquidar cobro al propietario y facturar comisión";
    endpoint = "propietarios";
    fields.push(
      {
        key: "expensesCents",
        label: "Gastos a descontar al propietario ($)",
        type: "money",
      },
      when,
    );
    map = (v) => ({
      ...v,
      receiptId: selected?.id,
      expensesCents: money(v.expensesCents),
    });
  } else if (mode === "pay") {
    title = `Orden de pago · ${selected?.owner_name}`;
    endpoint = `propietarios/${selected?.id}/pagar`;
    fields.push(cashField, when);
  } else if (mode === "sale") {
    title = "Reserva de propiedad";
    endpoint = "ventas";
    fields.push(
      {
        key: "propertyId",
        label: "Propiedad",
        options: options(
          props.data?.items.filter((p) => p.status === "disponible"),
          "address",
        ),
      },
      { key: "buyerId", label: "Comprador", party: "clientes" },
      { key: "priceCents", label: "Precio ($)", type: "money" },
      {
        key: "commissionPartyId",
        label: "A quién facturar honorarios",
        party: "clientes",
      },
      { key: "commissionCents", label: "Honorarios netos ($)", type: "money" },
      vatField,
      { key: "notes", label: "Notas" },
    );
    map = (v) => ({
      ...v,
      priceCents: money(v.priceCents),
      commissionCents: money(v.commissionCents),
      commissionVatBps: number(v.commissionVatBps),
    });
  } else if (mode === "deposit") {
    title = "Registrar seña como anticipo del comprador";
    endpoint = `ventas/${selected?.id}/sena`;
    fields.push(
      { key: "amountCents", label: "Seña ($)", type: "money" },
      cashField,
      when,
    );
    map = (v) => ({ ...v, amountCents: money(v.amountCents) });
  } else if (mode === "stage") {
    title = "Etapa de venta";
    endpoint = `ventas/${selected?.id}`;
    method = "PATCH";
    fields.push(
      {
        key: "stage",
        label: "Etapa",
        options: [
          { id: "sena", name: "Seña (sólo estado, no cobra)" },
          { id: "boleto", name: "Boleto" },
          { id: "escritura", name: "Escritura" },
          { id: "cancelada", name: "Cancelar" },
        ],
      },
      { key: "notes", label: "Referencia y observaciones" },
    );
  }
  async function sendForm(values: Record<string, string>) {
    const result = await apiSend<{ documentId?: string }>(
      `/api/inmobiliaria/${endpoint}`,
      method,
      map(values),
    );
    toast.success("Operación guardada");
    setMode("");
    await cache.invalidateQueries({ queryKey: ["estate"] });
    await cache.invalidateQueries({ queryKey: ["estate-options"] });
    if (result.documentId)
      toast.info("Comprobante disponible en Ventas para consultar e imprimir");
  }
  return (
    <main className="grid gap-4 p-4 md:p-6">
      {me.data && can(me.data.permissions,"inmobiliaria","anular") ? <BusinessReversalPanel sector="inmobiliaria" /> : null}
      <div>
        <h1 className="text-2xl font-semibold">Inmobiliaria</h1>
        <p className="text-sm text-muted-foreground">
          Propiedades, alquileres y liquidaciones. Comisión y mora se configuran
          por contrato; cero no aplica cargos.
        </p>
      </div>
      <nav
        className="flex flex-wrap gap-1"
        aria-label="Secciones de inmobiliaria"
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
      {rows.error ? <p role="alert">{rows.error.message}</p> : null}
      {tab === "resumen" && summary ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-3">
            {summary.properties?.map((p) => (
              <div className="rounded border bg-card p-3" key={p.status}>
                {p.status}: <strong>{p.count}</strong>
              </div>
            ))}
            <div className="rounded border bg-card p-3">
              Comisiones netas liquidadas:{" "}
              <strong>
                {formatMoney(
                  Number(summary.settlements?.commission_cents ?? 0),
                )}
              </strong>
            </div>
            <div className="rounded border bg-card p-3">
              Pendiente a propietarios:{" "}
              <strong>
                {formatMoney(Number(summary.settlements?.pending_cents ?? 0))}
              </strong>
            </div>
          </div>
          <section className="rounded border bg-card p-3">
            <h2 className="mb-2 font-semibold">
              Contratos por vencer o ajustar
            </h2>
            {summary.alerts?.map((c) => (
              <p className="border-t py-2 text-sm" key={String(c.id)}>
                {c.address} · fin {formatDate(String(c.ends_on))} · próximo
                ajuste{" "}
                {formatDate(
                  addMonths(
                    String(c.last_adjustment_on),
                    Number(c.adjustment_months),
                  ),
                )}{" "}
                ({c.adjustment_method})
              </p>
            ))}
            {!summary.alerts?.length ? (
              <p className="text-sm">Sin avisos en el período consultado.</p>
            ) : null}
          </section>
          <section className="rounded border bg-card p-3">
            <h2 className="mb-2 font-semibold">Morosidad</h2>
            {summary.late?.map((c) => (
              <p
                className="flex justify-between border-t py-2 text-sm"
                key={String(c.id)}
              >
                <span>
                  {c.tenant} · {c.address} · {c.period}
                </span>
                <strong>{formatMoney(Number(c.pending_cents))}</strong>
              </p>
            ))}
            {!summary.late?.length ? (
              <p className="text-sm">Sin alquileres vencidos pendientes.</p>
            ) : null}
          </section>
        </div>
      ) : null}
      {create ? (
        <div className="flex flex-wrap gap-2">
          {tab === "propiedades" ? (
            <Button onClick={() => open("property")}>Nueva propiedad</Button>
          ) : null}
          {tab === "contratos" ? (
            <Button onClick={() => open("contract")}>
              Nuevo contrato / renovación
            </Button>
          ) : null}
          {tab === "liquidaciones" ? (
            <Button onClick={() => open("charge")}>Liquidar mes</Button>
          ) : null}
          {tab === "ventas" ? (
            <Button onClick={() => open("sale")}>Nueva reserva</Button>
          ) : null}
        </div>
      ) : null}
      {fields.length ? (
        <EntryForm
          key={`${mode}-${selected?.id ?? "new"}`}
          title={title}
          fields={fields}
          onSave={sendForm}
          onCancel={() => setMode("")}
        />
      ) : null}
      {mode === "attachments" ? (
        <section className="grid gap-2 rounded border bg-card p-3">
          <h2 className="font-semibold">
            Fotos y documentación · {selected?.address}
          </h2>
          {attachments.data?.items.map((file) => (
            <a
              className="text-sm text-primary underline"
              key={file.id}
              href={`/api/inmobiliaria/adjuntos/${file.id}`}
              download
            >
              {file.filename}
            </a>
          ))}
          {create ? (
            <label className="grid gap-1 text-sm">
              Agregar JPG, PNG, WebP o PDF (máximo 5 MB)
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 5_000_000)
                      throw Error("El archivo supera 5 MB");
                    const content = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.onerror = () =>
                          reject(Error("No se pudo leer el archivo"));
                        reader.readAsDataURL(file);
                      },
                    );
                    await apiSend("/api/inmobiliaria/adjuntos", "POST", {
                      propertyId: selected?.id,
                      filename: file.name,
                      mime: file.type,
                      contentBase64: content,
                    });
                    await attachments.refetch();
                    toast.success("Archivo guardado");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "No se pudo subir",
                    );
                  }
                }}
              />
            </label>
          ) : null}
        </section>
      ) : null}
      {tab === "propiedades" ? (
        <Input
          aria-label="Buscar dirección"
          placeholder="Buscar dirección"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      ) : null}
      {tab !== "resumen" ? (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="p-2">Referencia</th>
                <th className="p-2">Detalle</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.data?.items?.map((row) => (
                <tr className="border-b" key={String(row.id)}>
                  <td className="p-2">
                    {row.address ?? row.owner_name}
                    <span className="block text-xs text-muted-foreground">
                      {row.tenant_name ??
                        row.buyer_name ??
                        row.owner_name ??
                        row.owner_name}
                    </span>
                  </td>
                  <td className="p-2">
                    {tab === "contratos"
                      ? `${formatDate(String(row.starts_on))} → ${formatDate(String(row.ends_on))} · ${row.status}`
                      : (row.period ??
                        row.stage ??
                        row.status ??
                        (row.paid_on ? "Pagada" : "Pendiente"))}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {tab === "propiedades"
                      ? "—"
                      : formatMoney(
                          Number(
                            row.current_rent_cents ??
                              row.payable_cents ??
                              row.price_cents ??
                              row.rent_cents ??
                              0,
                          ) +
                            Number(
                              tab === "liquidaciones" || tab === "cobros"
                                ? (row.extras_cents ?? 0)
                                : 0,
                            ),
                        )}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {tab === "propiedades" && edit ? (
                        <Button
                          variant="outline"
                          onClick={() => open("edit-property", row)}
                        >
                          Editar
                        </Button>
                      ) : null}
                      {tab === "propiedades" ? (
                        <Button
                          variant="outline"
                          onClick={() => open("attachments", row)}
                        >
                          Archivos
                        </Button>
                      ) : null}
                      {tab === "contratos" &&
                      create &&
                      row.status === "activo" ? (
                        <Button
                          variant="outline"
                          onClick={() => open("adjust", row)}
                        >
                          Ajustar
                        </Button>
                      ) : null}
                      {tab === "contratos" &&
                      edit &&
                      row.status === "activo" ? (
                        <Button
                          variant="outline"
                          onClick={() => open("conditions", row)}
                        >
                          Condiciones
                        </Button>
                      ) : null}
                      {tab === "contratos" &&
                      edit &&
                      row.status === "activo" ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "¿Finalizar el contrato? Conserva deudas y depósito pactado; no devuelve dinero.",
                              )
                            )
                              return;
                            try {
                              await apiSend(
                                `/api/inmobiliaria/contratos/${row.id}/finalizar`,
                                "PATCH",
                                { confirmation: "FINALIZAR" },
                              );
                              await rows.refetch();
                            } catch (e) {
                              toast.error(
                                e instanceof Error
                                  ? e.message
                                  : "No se pudo finalizar",
                              );
                            }
                          }}
                        >
                          Finalizar
                        </Button>
                      ) : null}
                      {tab === "liquidaciones" && create ? (
                        <Button
                          variant="outline"
                          onClick={() => open("collect", row)}
                        >
                          Cobrar
                        </Button>
                      ) : null}
                      {tab === "cobros" &&
                      create &&
                      !row.settlement_id &&
                      row.receipt_status === "confirmado" ? (
                        <Button
                          variant="outline"
                          onClick={() => open("settle", row)}
                        >
                          Liquidar al propietario
                        </Button>
                      ) : null}
                      {tab === "cobros" ? (
                        <a
                          className="text-primary underline"
                          href={`/ventas/${row.document_id}`}
                        >
                          Recibo
                        </a>
                      ) : null}
                      {tab === "propietarios" && create && !row.paid_on ? (
                        <Button
                          variant="outline"
                          onClick={() => open("pay", row)}
                        >
                          Pagar neto
                        </Button>
                      ) : null}
                      {tab === "propietarios" && row.invoice_id ? (
                        <a
                          className="text-primary underline"
                          href={`/ventas/${row.invoice_id}`}
                        >
                          Factura comisión
                        </a>
                      ) : null}
                      {tab === "ventas" && edit ? (
                        <Button
                          variant="outline"
                          onClick={() => open("stage", row)}
                        >
                          Etapa
                        </Button>
                      ) : null}
                      {tab === "ventas" &&
                      create &&
                      row.stage === "reserva" &&
                      !row.deposit_receipt_id ? (
                        <Button
                          variant="outline"
                          onClick={() => open("deposit", row)}
                        >
                          Cobrar seña
                        </Button>
                      ) : null}
                      {tab === "ventas" &&
                      create &&
                      !row.commission_invoice_id &&
                      Number(row.commission_cents) > 0 ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await apiSend(
                                `/api/inmobiliaria/ventas/${row.id}/facturar`,
                                "POST",
                                { occurredOn: todayIso() },
                              );
                              await rows.refetch();
                              toast.success("Honorarios facturados en Ventas");
                            } catch (e) {
                              toast.error(
                                e instanceof Error
                                  ? e.message
                                  : "No se pudo facturar",
                              );
                            }
                          }}
                        >
                          Facturar honorarios
                        </Button>
                      ) : null}
                      {tab === "ventas" && row.commission_invoice_id ? (
                        <a
                          className="text-primary underline"
                          href={`/ventas/${row.commission_invoice_id}`}
                        >
                          Honorarios
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.isPending ? (
            <p className="p-3 text-sm">Cargando…</p>
          ) : !rows.data?.items?.length ? (
            <p className="p-3 text-sm">No hay registros.</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Se muestran hasta 100 registros por sección. Los punitorios se calculan
        hasta la fecha elegida al liquidar, con interés diario simple y días de
        gracia; no se capitalizan. ICL e IPC requieren coeficiente y fuente
        cargados. La factura electrónica requiere configurar y verificar ARCA.
      </p>
    </main>
  );
}
