"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EmpresaImpositivaDetalle } from "./empresa-types";

export function EmpresaTaxConfig({ id, data }: { id: string; data: EmpresaImpositivaDetalle }) {
  const queryClient = useQueryClient();
  const [tolerance, setTolerance] = useState((data.config.toleranciaCents / 100).toFixed(2).replace(".", ","));
  const [createInTalon, setCreateInTalon] = useState(data.config.crearEnTalonDefault);
  const [points, setPoints] = useState(data.puntosVenta.map(item => item.numero).join(", "));
  const [activities, setActivities] = useState(data.actividades.map(item => `${item.codigo}; ${item.descripcion}${item.principal ? "; principal" : ""}`).join("\n"));
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsedTolerance = Number(tolerance.replace(",", "."));
    const puntosVenta = points.split(",").map(value => Number(value.trim())).filter(Number.isFinite);
    const actividades = activities.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const [codigo = "", descripcion = "", marker = ""] = line.split(";").map(value => value.trim());
      return { codigo, descripcion, principal: marker.toLowerCase() === "principal" };
    });
    if (!Number.isFinite(parsedTolerance) || parsedTolerance < 0) { toast.error("Ingresá una tolerancia válida"); return; }
    setPending(true);
    try {
      await apiSend(`/api/impuestos/empresas/${id}/configuracion`, "PATCH", {
        toleranciaCents: Math.round(parsedTolerance * 100),
        crearEnTalonDefault: createInTalon,
        puntosVenta,
        actividades,
      });
      await queryClient.invalidateQueries({ queryKey: ["impuestos-empresa", id] });
      toast.success("Configuración fiscal guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally { setPending(false); }
  }

  return <form onSubmit={save} className="grid max-w-2xl gap-4">
    <div className="grid gap-1"><label htmlFor="tax-tolerance" className="text-sm font-medium">Tolerancia de diferencias ($)</label><Input id="tax-tolerance" inputMode="decimal" value={tolerance} onChange={event => setTolerance(event.target.value)} /><p className="text-xs text-muted-foreground">Margen permitido al comparar totales importados. Por ejemplo, 0,05 equivale a cinco centavos.</p></div>
    <div className="grid gap-1"><label htmlFor="tax-points" className="text-sm font-medium">Puntos de venta</label><Input id="tax-points" value={points} onChange={event => setPoints(event.target.value)} placeholder="1, 2, 5" /><p className="text-xs text-muted-foreground">Separados por coma.</p></div>
    <div className="grid gap-1"><label htmlFor="tax-activities" className="text-sm font-medium">Actividades</label><textarea id="tax-activities" className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm" value={activities} onChange={event => setActivities(event.target.value)} placeholder={"Código; Descripción; principal\nCódigo; Descripción"} /><p className="text-xs text-muted-foreground">Una por línea. Usá “principal” en la tercera columna para marcar la actividad principal.</p></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createInTalon} onChange={event => setCreateInTalon(event.target.checked)} />Crear también la contraparte en Talón de forma predeterminada</label>
    <Button type="submit" disabled={pending} className="w-fit">{pending ? "Guardando…" : "Guardar configuración"}</Button>
  </form>;
}
