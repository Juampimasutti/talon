"use client";

import { useSearchParams } from "next/navigation";
import { useDebounced } from "@/components/use-debounced";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "@/lib/api/client";
import { taxConditionLabel } from "@/lib/fiscal/labels";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  userName: string | null;
  changes?: { field: string; before: unknown; after: unknown }[];
};

function readableMoney(summary: string): string {
  return summary.replace(
    /Arqueo (\d+) contra (\d+)/,
    (_match, counted: string, expected: string) =>
      `Arqueo ${formatMoney(Number(counted))} contra ${formatMoney(Number(expected))}`,
  );
}

function auditValue(field: string, value: unknown) {
  if (value == null || value === "") return "—";
  if (field === "creditLimitCents") return formatMoney(Number(value));
  if (field === "discountBps" || field === "iibbPerceptionBps")
    return `${Number(value) / 100}%`;
  if (field === "active") return value ? "Sí" : "No";
  if (field === "taxCondition") return taxConditionLabel(String(value));
  return String(value);
}

export function AuditoriaScreen() {
  const me = useMe();
  const params = useSearchParams();
  const entity = params.get("entidad") ?? "";
  const record = params.get("registro") ?? "";
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const log = useQuery({
    queryKey: [
      "auditoria",
      me.data?.company.id,
      debounced,
      accion,
      page,
      entity,
      record,
    ],
    enabled: Boolean(me.data),
    queryFn: () =>
      apiGet<{ items: Row[]; total: number; pageSize: number }>(
        `/api/auditoria?page=${page}&pageSize=40&q=${encodeURIComponent(debounced)}&accion=${encodeURIComponent(accion)}&entidad=${encodeURIComponent(entity)}&registro=${encodeURIComponent(record)}`,
      ),
  });
  const total = log.data?.total ?? 0;
  const pageSize = log.data?.pageSize ?? 40;
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-3xl tracking-tight sm:text-4xl">Auditoría</h1>
        <p className="text-sm text-muted-foreground">
          Quién hizo qué, en esta empresa.
        </p>
      </div>
      {record ? (
        <p className="text-sm">
          Historial de esta ficha o comprobante.{" "}
          <a className="text-primary underline" href="/auditoria">
            Ver toda la auditoría
          </a>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder="Buscar en el texto"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <Input
          className="w-40"
          placeholder="Acción"
          value={accion}
          onChange={(event) => {
            setAccion(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {log.data?.items.map((row) => (
          <li key={row.id} className="px-4 py-3 text-sm">
            <p>{readableMoney(row.summary)}</p>
            {row.changes?.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-primary">
                  Ver campos modificados
                </summary>
                <ul className="mt-1 space-y-1 text-xs">
                  {row.changes.map((change) => (
                    <li key={change.field}>
                      {(
                        {
                          name: "Nombre",
                          fantasyName: "Nombre de fantasía",
                          cuit: "Documento",
                          docType: "Tipo de documento",
                          taxCondition: "Condición IVA",
                          phone: "Teléfono",
                          email: "Correo",
                          address: "Domicilio",
                          city: "Localidad",
                          province: "Provincia",
                          active: "Activo",
                          creditLimitCents: "Límite de crédito",
                          discountBps: "Descuento",
                          iibbPerceptionBps: "Percepción IIBB",
                          priceListId: "Lista de precios",
                          notes: "Notas",
                        } as Record<string, string>
                      )[change.field] ?? change.field}
                      :{" "}
                      {change.field === "priceListId"
                        ? "Se cambió la lista asignada"
                        : `${auditValue(change.field, change.before)} → ${auditValue(change.field, change.after)}`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-muted-foreground">
              {row.userName ?? "Alguien"} · {formatDateTime(row.createdAt)} ·{" "}
              {row.action}
            </p>
          </li>
        ))}
      </ul>
      {log.data && log.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay movimientos con ese filtro.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Anterior
        </Button>
        <span className="text-sm text-muted-foreground">
          {page} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <Button
          variant="outline"
          disabled={page * pageSize >= total}
          onClick={() => setPage((current) => current + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
