"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api/client";
import { formatCuit } from "@/lib/fiscal/cuit";
import { rememberEmpresa } from "@/lib/impuestos/seleccion";
import { Button } from "@/components/ui/button";
import { EmpresaTaxConfig } from "./empresa-tax-config";
import { SECCIONES_IMPUESTOS, type EmpresaImpositivaDetalle, type SeccionImpuestos } from "./empresa-types";

export function EmpresaDetailScreen({ id, seccion }: { id: string; seccion?: SeccionImpuestos }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["impuestos-empresa", id], queryFn: () => apiGet<EmpresaImpositivaDetalle>(`/api/impuestos/empresas/${id}`) });
  useEffect(() => rememberEmpresa(id), [id]);
  if (query.isLoading) return <main className="p-6 text-sm text-muted-foreground">Cargando empresa…</main>;
  if (!query.data) return <main className="p-6 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "No se encontró la empresa"}</main>;
  const { empresa, counts } = query.data;
  const title = SECCIONES_IMPUESTOS.find(item => item.key === seccion)?.label;

  async function deactivate() {
    if (!window.confirm(`¿Dar de baja ${empresa.nombre}? Sus datos fiscales se conservarán.`)) return;
    await apiSend(`/api/impuestos/empresas/${id}`, "DELETE");
    await queryClient.invalidateQueries({ queryKey: ["impuestos-empresas"] });
    router.push("/impuestos");
  }

  return <main className="space-y-4 p-4 sm:p-6">
    <header className="rounded border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresa seleccionada</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{empresa.nombre}</h1><p className="text-sm text-muted-foreground">{empresa.razonSocial} · {formatCuit(empresa.cuit)}</p></div>
        <div className="flex gap-2"><Link className="inline-flex h-8 items-center rounded-lg border px-3 text-sm" href={`/impuestos/empresas/${id}/editar`}>Editar</Link><Button variant="destructive" onClick={deactivate}>Dar de baja</Button></div>
      </div>
    </header>
    {!seccion ? <section className="grid gap-2 text-sm sm:grid-cols-4"><Stat label="Compras" value={counts.compras} /><Stat label="Ventas" value={counts.ventas} /><Stat label="Períodos" value={counts.periodos} /><Stat label="Liquidaciones" value={counts.liquidaciones} /></section> :
      <section className="space-y-4 rounded border bg-card p-4">
        <h2 className="font-semibold">{title}</h2>
        {seccion === "configuracion" ? <EmpresaTaxConfig id={id} data={query.data} /> : <>
          <p className="text-sm text-muted-foreground">Los datos de esta sección corresponden exclusivamente a {empresa.nombre}.</p>
          {seccion === "ventas" ? <InternalLinks links={[
            [`/impuestos/empresas/${id}/libro-iva?libro=ventas`, "Libro IVA Ventas"],
            [`/impuestos/empresas/${id}/liquidacion`, "Liquidación de IVA"],
          ]} /> : null}
          {seccion === "compras" ? <InternalLinks links={[[`/impuestos/empresas/${id}/libro-iva?libro=compras`, "Libro IVA Compras"]]} /> : null}
          <div className="grid gap-2 text-sm sm:grid-cols-4"><Stat label="Compras" value={counts.compras} /><Stat label="Ventas" value={counts.ventas} /><Stat label="Períodos" value={counts.periodos} /><Stat label="Liquidaciones" value={counts.liquidaciones} /></div>
        </>}
      </section>}
  </main>;
}

function InternalLinks({ links }: { links: [string, string][] }) {
  return <nav className="flex flex-wrap gap-2" aria-label="Navegación de la sección">{links.map(([href, label]) => <Link key={href} href={href} className="inline-flex h-8 items-center rounded-lg border px-3 text-sm text-primary hover:bg-muted">{label}</Link>)}</nav>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded border p-3"><span className="block text-xs text-muted-foreground">{label}</span><strong className="text-lg">{value}</strong></div>;
}
