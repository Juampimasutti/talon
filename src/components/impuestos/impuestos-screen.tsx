"use client";

import Link from "next/link";
import { AlertTriangle, Building2, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { formatCuit } from "@/lib/fiscal/cuit";
import { rememberEmpresa } from "@/lib/impuestos/seleccion";
import type { EmpresaImpositiva } from "./empresa-types";

export function ImpuestosScreen() {
  const query = useQuery({ queryKey: ["impuestos-empresas"], queryFn: () => apiGet<{ items: EmpresaImpositiva[] }>("/api/impuestos/empresas") });
  const items = query.data?.items ?? [];
  return <main className="space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">Empresas</h1><p className="mt-1 text-sm text-muted-foreground">Clientes impositivos administrados por el estudio.</p></div>
      <Link href="/impuestos/empresas/nueva" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"><Plus className="size-4" />Agregar empresa</Link>
    </header>
    <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>Los borradores no constituyen una presentación ante ARCA.</p></div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Cargando empresas…</p> : query.error ? <p className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "No se pudieron cargar las empresas"}</p> : items.length === 0 ? <section className="rounded border bg-card p-6 text-center"><Building2 className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">Todavía no hay empresas clientes</h2><p className="mt-1 text-sm text-muted-foreground">Agregá la primera para comenzar a organizar sus impuestos.</p></section> :
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Empresas clientes">{items.map(item => <Link key={item.id} href={`/impuestos/empresas/${item.id}`} onClick={() => rememberEmpresa(item.id)} className="rounded border bg-card p-4 transition-colors hover:border-primary hover:bg-muted/30"><Building2 className="mb-3 size-5 text-primary" /><span className="block font-semibold">{item.nombre}</span><span className="mt-1 block text-sm text-muted-foreground">{item.razonSocial}</span><span className="mt-2 block text-xs tabular-nums text-muted-foreground">CUIT {formatCuit(item.cuit)}</span></Link>)}</section>}
  </main>;
}
