"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
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
import { toast } from "sonner";
import { ApiError, apiSend, clearSessionCache, type Me } from "@/lib/api/client";
import { sectionAccess } from "@/lib/auth/access";
import { visibleModules } from "@/lib/auth/permissions";
import { taxConditionLabel } from "@/lib/fiscal/labels";
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
  reparto: "/reparto",
  informes: "/informes",
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
  reparto: Route,
  informes: ClipboardList,
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
  useEffect(() => {
    if (access !== "deny" && access !== "module-off") return;
    const message = access === "module-off" ? "Ese módulo está desactivado" : "No tenés acceso a esa sección";
    toast.error(message);
    router.replace("/tablero");
  }, [access, router]);

  if (!session) return <ScreenFallback label="Abriendo la empresa" />;
  if (access === "deny" || access === "module-off") {
    return <p className="p-6 text-sm">{access === "module-off" ? "Ese módulo está desactivado" : "No tenés acceso a esa sección"}</p>;
  }
  const data = session;
  const items = visibleModules(data.company.modules, data.permissions);

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
      {items.map((item) => {
        const href = HREF[item.key] ?? "/tablero";
        const Icon = ICONS[item.key] ?? FileText;
        const active = pathname === href || pathname.startsWith(`${href}/`);
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
          <Brand compact />
          <span className="hidden border-l pl-4 text-xs text-muted-foreground sm:block">Gestión comercial</span>
        </div>
        <div className="hidden min-w-0 items-center gap-4 text-xs text-muted-foreground lg:flex">
          <span className="max-w-80 truncate">{data.company.name}</span>
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
          <OfflineBanner />
          {children}
        </main>
        </div>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/tablero" className={compact ? "talon-brand" : "talon-brand px-3"}>
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
        <label className="grid gap-1 text-xs text-sidebar-foreground/70">
          Empresa
          <select
            className="h-8 rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground"
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
