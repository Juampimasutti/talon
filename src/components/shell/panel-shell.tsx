"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  Calculator,
  Landmark,
  ClipboardList,
  ArrowLeftRight,
  FileText,
  Fuel,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiSend, clearSessionCache, type Me } from "@/lib/api/client";
import { sectionAccess } from "@/lib/auth/access";
import { visibleModules } from "@/lib/auth/permissions";
import { taxConditionLabel } from "@/lib/fiscal/labels";
import { formatCuit } from "@/lib/fiscal/cuit";
import type { EmpresaImpositiva } from "@/components/impuestos/empresa-types";
import { empresaIdFromPath, useRememberedEmpresa } from "@/lib/impuestos/seleccion";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScreenFallback } from "@/components/screen-fallback";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { useCachedMe, useMe } from "@/components/use-me";

const HREF: Record<string, string> = {
  dashboard: "/tablero",
  clientes: "/clientes",
  proveedores: "/proveedores",
  articulos: "/articulos",
  ventas: "/ventas",
  compras: "/compras",
  pedidos: "/pedidos",
  remitos: "/remitos",
  stock: "/stock",
  caja: "/caja",
  cuentas_corrientes: "/cuentas",
  contabilidad: "/contabilidad",
  comprobantes: "/comprobantes",
  auditoria: "/auditoria",
  estacion: "/estacion",
  constructora: "/constructora",
  inmobiliaria: "/inmobiliaria",
  reparto: "/reparto",
  informes: "/informes",
  impuestos: "/impuestos",
  configuracion: "/configuracion",
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  clientes: Users,
  proveedores: Truck,
  articulos: Package,
  ventas: Receipt,
  compras: ShoppingCart,
  pedidos: ClipboardList,
  remitos: FileText,
  stock: Warehouse,
  caja: Wallet,
  cuentas_corrientes: BookOpen,
  contabilidad: Landmark,
  comprobantes: ScrollText,
  auditoria: ScrollText,
  estacion: Fuel,
  constructora: Warehouse,
  inmobiliaria: Landmark,
  reparto: Route,
  informes: ClipboardList,
  impuestos: Calculator,
  configuracion: Settings,
};

export function PanelShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const me = useMe();
  const cached = useCachedMe();
  const session = me.data ?? cached;
  const isStudy = session?.company.tipo === "estudio";
  const hasTaxes = Boolean(session && visibleModules(session.company.modules, session.permissions).some((item) => item.key === "impuestos"));
  const companies = useQuery({
    queryKey: ["impuestos-empresas"],
    queryFn: () => apiSend<{ items: EmpresaImpositiva[] }>("/api/impuestos/empresas", "GET"),
    enabled: Boolean(isStudy && hasTaxes),
  });
  const rememberedTaxCompany = useRememberedEmpresa();

  useEffect(() => {
    if (isStudy && pathname === "/tablero") router.replace(hasTaxes ? "/impuestos" : "/configuracion");
  }, [hasTaxes, isStudy, pathname, router]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/ingreso");
  }, [me.error, router]);

  useEffect(() => {
    const userId = session?.user.id ?? null;
    const companyId = session?.company.id ?? null;
    void import("@/lib/offline/submit").then((mod) => mod.setOfflineScope(userId, companyId));
  }, [session?.user.id, session?.company.id]);

  useEffect(() => {
    function onSynced(event: Event) {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
    }
    window.addEventListener("talon-synced", onSynced);
    return () => window.removeEventListener("talon-synced", onSynced);
  }, [queryClient]);

  const access = session && pathname !== "/tablero" ? sectionAccess(pathname, session.permissions, session.company.modules) : "allow";

  if (!session) return <ScreenFallback label="Abriendo la empresa" />;
  if (access === "deny" || access === "module-off") {
    return <main className="mx-auto max-w-lg p-6"><h1 className="text-lg font-semibold">{access === "module-off" ? "Módulo no activo" : "Sin permiso"}</h1><p className="mt-2 text-sm text-muted-foreground">{access === "module-off" ? "Esta sección no está habilitada en la empresa seleccionada." : "Tu puesto no tiene acceso a esta sección. Consultá con la administración."}</p><Link className="mt-4 inline-block text-sm text-primary underline" href={isStudy ? "/configuracion" : "/tablero"}>Volver</Link></main>;
  }
  const data = session;
  const items = visibleModules(data.company.modules, data.permissions).filter((item) => !(isStudy && item.key === "dashboard"));
  const studyCanAudit = isStudy && items.some((item) => item.key === "auditoria");
  const studyHasConfig = isStudy && items.some((item) => item.key === "configuracion");
  const navItems = isStudy ? items.filter((item) => item.key !== "auditoria") : items;
  const selectedTaxCompany = empresaIdFromPath(pathname) ?? rememberedTaxCompany;
  const selectedCompany = companies.data?.items.find((item) => item.id === selectedTaxCompany) ?? null;

  async function leave() {
    await apiSend("/api/auth/logout", "POST");
    const offline = await import("@/lib/offline/submit");
    offline.setOfflineScope(null, null);
    clearSessionCache();
    queryClient.clear();
    window.location.assign("/ingreso");
  }

  async function changeCompany(companyId: string) {
    await apiSend("/api/auth/empresa", "POST", { companyId });
    clearSessionCache();
    queryClient.clear();
    router.replace("/tablero");
  }

  const nav = (
    <nav className="grid gap-0.5" aria-label="Módulos">
      {navItems.map((item) => {
        const href = HREF[item.key] ?? "/tablero";
        const Icon = ICONS[item.key] ?? FileText;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        if (item.key === "impuestos" && isStudy) return <StudyTaxNav key={item.key} pathname={pathname} close={() => setOpen(false)} selected={selectedCompany} />;
        if (item.key === "configuracion" && isStudy) return <StudyConfigNav key={item.key} pathname={pathname} close={() => setOpen(false)} showConfig showAudit={studyCanAudit} />;
        return (
          <Link
            key={item.key}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className="talon-nav-link"
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
      {isStudy && studyCanAudit && !studyHasConfig ? <StudyConfigNav pathname={pathname} close={() => setOpen(false)} showConfig={false} showAudit /> : null}
      {items.some((item) => item.key === "articulos") ? (
        <Link href="/listas" onClick={() => setOpen(false)} aria-current={pathname.startsWith("/listas") ? "page" : undefined} className="talon-nav-link">
          <Package className="size-4" />
          Listas de precios
        </Link>
      ) : null}
      {data.permissions.some((permission) => permission.endsWith(".importar") || permission.endsWith(".exportar")) ? (
        <Link
          href="/datos"
          onClick={() => setOpen(false)}
          aria-current={pathname.startsWith("/datos") ? "page" : undefined}
          className="talon-nav-link"
        >
          <ArrowLeftRight className="size-4" />
          Datos
        </Link>
      ) : null}
    </nav>
  );

  return (
    <div className="talon-app min-h-screen">
      <header className="talon-topbar">
        <div className="flex items-center gap-4">
          <Brand compact href={isStudy ? "/impuestos" : "/tablero"} />
          <span className="hidden border-l pl-4 text-xs text-muted-foreground sm:block">{isStudy ? "Estudio contable" : "Gestión comercial"}</span>
        </div>
        <div className="hidden min-w-0 items-center gap-4 text-xs text-muted-foreground lg:flex">
          <span className="max-w-80 truncate">{selectedCompany ? `${selectedCompany.nombre} · CUIT ${formatCuit(selectedCompany.cuit)}` : data.company.name}</span>
          <span className="border-l pl-4">{data.user.name} · {data.role.name}</span>
        </div>
        <div className="lg:hidden">
          <Button variant="outline" size="icon" aria-label="Abrir menú" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
        </div>
      </header>
      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="talon-sidebar hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden lg:flex lg:flex-col lg:px-2 lg:py-3">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{nav}</div>
          <div className="mt-3 shrink-0 border-t border-sidebar-border pt-3">
            <UserBlock data={data} onLeave={leave} onCompany={changeCompany} />
          </div>
        </aside>
        <div className="min-w-0">
        {!data.rlsEnforced ? (
          <p className="bg-amber-100 px-4 py-2 text-sm text-amber-950">
            Estás conectado con un rol que saltea el aislamiento de la base. Los permisos de la aplicación siguen activos. Conviene usar el usuario talon_app.
          </p>
        ) : null}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="overflow-y-auto bg-sidebar text-sidebar-foreground">
            <SheetHeader>
              <SheetTitle className="text-sidebar-foreground">Talón</SheetTitle>
            </SheetHeader>
            <div className="px-2">{nav}</div>
            <div className="mt-6">
              <UserBlock data={data} onLeave={leave} onCompany={changeCompany} />
            </div>
          </SheetContent>
        </Sheet>
        <main className="min-w-0 overflow-x-auto">
          {selectedCompany ? <div className="border-b bg-muted/60 px-4 py-2 text-xs lg:hidden"><span className="font-medium">{selectedCompany.nombre}</span><span className="ml-2 tabular-nums text-muted-foreground">CUIT {formatCuit(selectedCompany.cuit)}</span></div> : null}
          <OfflineBanner />
          {children}
        </main>
        </div>
      </div>
    </div>
  );
}

function StudyTaxNav({ pathname, close, selected }: { pathname: string; close: () => void; selected: EmpresaImpositiva | null }) {
  const companiesActive = pathname === "/impuestos" || pathname.includes("/editar") || pathname.includes("/nueva");
  const sections = [
    ["ventas", "Ventas"],
    ["compras", "Compras"],
    ["configuracion", "Configuración"],
  ] as const;
  return <>
    <Link href="/impuestos" onClick={close} aria-current={companiesActive ? "page" : undefined} className="talon-nav-link"><Building2 className="size-4" />Empresas</Link>
    <details className="group" open={pathname.startsWith("/impuestos/empresas/") || undefined}>
      <summary className="talon-nav-link cursor-pointer list-none"><Calculator className="size-4" />Impuestos</summary>
      <div className="ml-5 grid gap-0.5 border-l border-sidebar-border pl-2">
        {selected ? <>
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">Empresa seleccionada</p>
          <p className="truncate px-2 text-xs font-semibold" title={selected.nombre}>{selected.nombre}</p>
          <p className="px-2 pb-1 text-[10px] tabular-nums opacity-70">{formatCuit(selected.cuit)}</p>
          {sections.map(([key, label]) => {
            const href = `/impuestos/empresas/${selected.id}/${key}`;
            return <Link key={key} href={href} onClick={close} aria-current={pathname === href ? "page" : undefined} className="rounded px-2 py-1.5 text-xs hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent">{label}</Link>;
          })}
        </> : <Link href="/impuestos" onClick={close} className="rounded px-2 py-1.5 text-xs hover:bg-sidebar-accent">Elegí una empresa</Link>}
      </div>
    </details>
  </>;
}

function StudyConfigNav({ pathname, close, showConfig, showAudit }: { pathname: string; close: () => void; showConfig: boolean; showAudit: boolean }) {
  const active = pathname === "/configuracion" || pathname.startsWith("/configuracion/") || pathname === "/auditoria" || pathname.startsWith("/auditoria/");
  return <details className="group" open={active || undefined}>
    <summary className={`talon-nav-link cursor-pointer list-none ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}><Settings className="size-4" />Configuración</summary>
    <div className="ml-5 grid gap-0.5 border-l border-sidebar-border pl-2">
      {showConfig ? <Link href="/configuracion" onClick={close} aria-current={pathname.startsWith("/configuracion") ? "page" : undefined} className="rounded px-2 py-1.5 text-xs hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent">General</Link> : null}
      {showAudit ? <Link href="/auditoria" onClick={close} aria-current={pathname.startsWith("/auditoria") ? "page" : undefined} className="rounded px-2 py-1.5 text-xs hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent">Auditoría</Link> : null}
    </div>
  </details>;
}

function Brand({ compact = false, href = "/tablero" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className={compact ? "talon-brand" : "talon-brand px-3"}>
      Talón
      {compact ? null : <span className="mt-1 block font-sans text-xs font-normal tracking-normal text-sidebar-foreground/70">gestión comercial</span>}
    </Link>
  );
}

function UserBlock({
  data,
  onLeave,
  onCompany,
}: {
  data: Me;
  onLeave: () => void;
  onCompany: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 px-1 pb-2 text-sm">
      {data.companies.length > 1 ? (
        <label className="grid min-w-0 gap-1 text-xs text-sidebar-foreground/70">
          Empresa
          <select
            className="h-8 w-full min-w-0 max-w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground"
            value={data.company.id}
            onChange={(event) => onCompany(event.target.value)}
          >
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="px-2 text-sidebar-foreground/80">{data.company.name}</p>
      )}
      <p className="px-2 text-xs text-sidebar-foreground/60">
        {data.user.name} · {data.role.name}
        <br />
        {taxConditionLabel(data.company.taxCondition)}
      </p>
      <Button variant="ghost" className="mb-2 justify-start text-sidebar-foreground hover:bg-sidebar-accent" onClick={onLeave}>
        <LogOut />
        Salir
      </Button>
    </div>
  );
}
