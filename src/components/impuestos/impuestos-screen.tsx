"use client";

import { AlertTriangle, BookOpen, Calculator, FileSpreadsheet, Settings } from "lucide-react";
import { useMe } from "@/components/use-me";

const options = [
  { href: "/impuestos/libro/ventas", title: "Libro IVA Ventas", description: "Comprobantes emitidos y débito fiscal.", icon: BookOpen },
  { href: "/impuestos/libro/compras", title: "Libro IVA Compras", description: "Comprobantes recibidos y crédito fiscal.", icon: BookOpen },
  { href: "/impuestos/importar", title: "Importar", description: "Mis Comprobantes de ARCA.", icon: FileSpreadsheet },
  { href: "/impuestos/liquidacion", title: "Liquidación", description: "Borrador mensual de IVA.", icon: Calculator },
  { href: "/impuestos/exportar", title: "Exportar", description: "Archivos del Libro IVA Digital.", icon: FileSpreadsheet },
  { href: "/impuestos/configuracion", title: "Configuración", description: "Puntos de venta, actividades y criterios.", icon: Settings },
] as const;

export function ImpuestosScreen() {
  const me = useMe();
  return (
    <main className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Impuestos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Libro IVA y preparación de la liquidación mensual.</p>
      </header>
      <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>Etapa inicial. Los borradores no constituyen una presentación ante ARCA.</p>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Secciones de impuestos">
        {options.map(({ href, title, description, icon: Icon }) => (
          <a key={href} href={href} className="rounded border bg-card p-4 transition-colors hover:border-primary">
            <Icon className="size-5 text-primary" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-3 text-xs font-medium text-primary">Abrir</p>
          </a>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">
        Empresa activa: {me.data?.company.name ?? "Cargando…"}. Las tablas pendientes de verificación oficial permanecen sin datos.
      </p>
    </main>
  );
}
