"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet } from "@/lib/api/client";
import { formatNumber, formatMoney, todayIso } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { id: string; name: string }[];
  party?: "clientes" | "proveedores";
  lookup?: "articulos" | "compras";
  initial?: string;
};
function PartyPicker({
  side,
  value,
  onChange,
  label,
}: {
  label: string;
  side: "clientes" | "proveedores";
  value: string;
  onChange: (value: string) => void;
}) {
  const me = useMe();
  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const result = useQuery({
    enabled: !!me.data?.company.id,
    queryKey: ["business-party", me.data?.company.id, side, term],
    queryFn: () =>
      apiGet<{ items: { id: string; name: string }[] }>(
        `/api/${side}?q=${encodeURIComponent(term)}&pageSize=100`,
      ),
  });
  const found = result.data?.items.some((item) => item.id === value);
  const current = useQuery({
    queryKey: ["business-party-selected", me.data?.company.id, side, value],
    enabled: !!me.data?.company.id && !!value && !found,
    queryFn: () => apiGet<{ name: string }>(`/api/${side}/${value}`),
  });
  return (
    <div className="grid gap-1">
      <Input
        aria-label={`Buscar ${label}`}
        placeholder={`Buscar ${side}`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChange("");
        }}
      />
      <select
        aria-label={label}
        className="h-8 rounded border px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Elegir…</option>
        {value && !found ? (
          <option value={value}>
            {current.data?.name ?? "Cargando ficha seleccionada…"}
          </option>
        ) : null}
        {result.data?.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
function RecordPicker({
  resource,
  label,
  value,
  onChange,
}: {
  resource: "articulos" | "compras";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const me = useMe();
  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const records = useQuery({
    queryKey: ["business-records", me.data?.company.id, resource, term],
    enabled: !!me.data?.company.id,
    queryFn: () =>
      apiGet<{ items: Record<string, unknown>[] }>(
        resource === "articulos"
          ? `/api/articulos?q=${encodeURIComponent(term)}&pageSize=100`
          : `/api/documentos?kind=compra&status=confirmado&q=${encodeURIComponent(term)}&pageSize=100`,
      ),
  });
  const listed = records.data?.items.some((item) => item.id === value);
  const current = useQuery({
    queryKey: [
      "business-record-selected",
      me.data?.company.id,
      resource,
      value,
    ],
    enabled: !!me.data?.company.id && !!value && !listed,
    queryFn: () =>
      apiGet<Record<string, unknown>>(
        `/api/${resource === "articulos" ? "articulos" : "documentos"}/${value}`,
      ),
  });
  function name(item: Record<string, unknown>) {
    return resource === "articulos"
      ? `${item.sku} · ${item.name}`
      : `${item.partyName} · ${formatNumber(Number(item.pointOfSale), Number(item.number))} · ${formatMoney(Number(item.totalCents))}`;
  }
  return (
    <div className="grid gap-1">
      <Input
        aria-label={`Buscar ${label}`}
        placeholder={
          resource === "articulos"
            ? "Buscar por código o nombre"
            : "Buscar proveedor o comprobante"
        }
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChange("");
        }}
      />
      <select
        aria-label={label}
        className="h-8 rounded border px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Elegir…</option>
        {value && !listed ? (
          <option value={value}>
            {current.data ? name(current.data) : "Cargando selección…"}
          </option>
        ) : null}
        {records.data?.items
          .filter(
            (item) => resource !== "articulos" || item.tracksStock !== false,
          )
          .map((item) => (
            <option key={String(item.id)} value={String(item.id)}>
              {name(item)}
            </option>
          ))}
      </select>
    </div>
  );
}
export function EntryForm({
  title,
  fields,
  onSave,
  onCancel,
}: {
  title: string;
  fields: Field[];
  onSave: (values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.initial ??
          (f.type === "date"
            ? todayIso()
            : f.type === "money" || f.type === "rate"
              ? "0"
              : ""),
      ]),
    ),
  );
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-3 rounded border bg-card p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        try {
          await onSave(values);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "No se pudo guardar",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <h2 className="font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <label className="grid gap-1 text-sm" key={field.key}>
            {field.label}
            {field.lookup ? (
              <RecordPicker
                resource={field.lookup}
                label={field.label}
                value={values[field.key]}
                onChange={(value) =>
                  setValues({ ...values, [field.key]: value })
                }
              />
            ) : field.party ? (
              <PartyPicker
                label={field.label}
                side={field.party}
                value={values[field.key]}
                onChange={(value) =>
                  setValues({ ...values, [field.key]: value })
                }
              />
            ) : field.options ? (
              <select
                aria-label={field.label}
                className="h-8 rounded border px-2"
                value={values[field.key]}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              >
                <option value="">Elegir…</option>
                {field.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={
                  field.type === "date" ||
                  field.type === "month" ||
                  field.type === "number"
                    ? field.type
                    : "text"
                }
                inputMode={
                  field.type === "money" || field.type === "rate"
                    ? "decimal"
                    : undefined
                }
                value={values[field.key]}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button disabled={pending} type="submit">
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
