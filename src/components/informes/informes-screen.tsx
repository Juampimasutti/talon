"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "@/lib/api/client";
import { todayIso } from "@/lib/format";
import { useCatalog, useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TIPOS = [
  ["ventas", "Ventas"],
  ["compras", "Compras"],
  ["iva-ventas", "Libro IVA ventas"],
  ["iva-compras", "Libro IVA compras"],
  ["cuentas", "Cuentas corrientes"],
  ["antiguedad", "Antigüedad de saldos"],
  ["stock", "Valuación de stock"],
  ["movimientos", "Movimientos de stock"],
  ["mermas", "Mermas"],
  ["caja", "Caja"],
  ["turnos", "Turnos por playero"],
  ["vales", "Vales de flota"],
  ["reparto", "Reparto"],
  ["rentabilidad", "Rentabilidad"],
] as const;

export function InformesScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const [tipo, setTipo] = useState("ventas");
  const [desde, setDesde] = useState(() => todayIso(new Date(Date.now() - 30 * 864e5)));
  const [hasta, setHasta] = useState(todayIso());
  const [deposito, setDeposito] = useState("");
  const report = useQuery({
    queryKey: ["informes", me.data?.company.id, tipo, desde, hasta, deposito],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<{ columns: string[]; rows: string[][] }>(`/api/informes?tipo=${tipo}&desde=${desde}&hasta=${hasta}&deposito=${encodeURIComponent(deposito)}`),
  });
  const href = `/api/informes?tipo=${tipo}&desde=${desde}&hasta=${hasta}&deposito=${encodeURIComponent(deposito)}&formato=xlsx`;
  return (
    <div className="grid gap-4 p-4 print:p-0 md:p-6">
      <p className="hidden print:block text-sm">{me.data?.company.name} · {TIPOS.find(([key]) => key === tipo)?.[1] ?? "Informe"} · {desde} a {hasta}</p>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-3xl tracking-tight sm:text-4xl">Informes</h1>
          <p className="text-sm text-muted-foreground">Filtrá por fecha y depósito. Excel baja el mismo corte. Imprimir sirve para guardarlo como PDF.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-8 items-center rounded-lg border px-3 text-sm" href={href}>Excel</a>
          <Button variant="outline" onClick={() => window.print()}>Imprimir / PDF</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <select className="h-8 rounded-lg border px-2 text-sm" value={tipo} onChange={(event) => setTipo(event.target.value)}>
          {TIPOS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <Input className="w-36" type="date" value={desde} onChange={(event) => setDesde(event.target.value)} />
        <Input className="w-36" type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} />
        <select className="h-8 rounded-lg border px-2 text-sm" value={deposito} onChange={(event) => setDeposito(event.target.value)} aria-label="Depósito">
          <option value="">Todos los depósitos</option>
          {(catalog.data?.warehouses ?? []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
      </div>
      <div className="overflow-auto rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/70 text-left">
            <tr>{(report.data?.columns ?? []).map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
          </thead>
          <tbody>
            {(report.data?.rows ?? []).map((row, index) => (
              <tr key={index} className="border-t">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {report.data && report.data.rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No hay movimientos en ese período.</p> : null}
      </div>
    </div>
  );
}
