import { can, moduleEnabled } from "./permissions";

const SECTIONS: [string, string][] = [
  ["/caja", "caja"],
  ["/ventas", "ventas"],
  ["/compras", "compras"],
  ["/auditoria", "auditoria"],
  ["/stock", "stock"],
  ["/articulos", "articulos"],
  ["/listas", "articulos"],
  ["/clientes", "clientes"],
  ["/proveedores", "proveedores"],
  ["/cuentas", "cuentas_corrientes"],
  ["/contabilidad", "contabilidad"],
  ["/comprobantes", "comprobantes"],
  ["/configuracion", "configuracion"],
  ["/estacion", "estacion"],
  ["/constructora", "constructora"],
  ["/inmobiliaria", "inmobiliaria"],
  ["/reparto", "reparto"],
  ["/informes", "informes"],
  ["/pedidos", "pedidos"],
  ["/remitos", "remitos"],
];

export function sectionOf(pathname: string): { prefix: string; module: string } | null {
  const found = SECTIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return found ? { prefix: found[0], module: found[1] } : null;
}

/** Ver entra a la sección. Crear hace falta para /nueva. El resto se niega. */
export function sectionAccess(pathname: string, permissions: Iterable<string>, modules: readonly string[]): "allow" | "deny" | "module-off" {
  if (pathname.startsWith("/datos")) {
    const canMove = [...permissions].some((permission) => permission.endsWith(".importar") || permission.endsWith(".exportar"));
    return canMove ? "allow" : "deny";
  }
  const section = sectionOf(pathname);
  if (!section) return "allow";
  if (!moduleEnabled(modules, section.module)) return "module-off";
  if (section.prefix === "/estacion" && (pathname === "/estacion/equipos" || pathname.startsWith("/estacion/equipos/"))) {
    return can(permissions, "estacion", "editar") ? "allow" : "deny";
  }
  if (!can(permissions, section.module, "ver")) return "deny";
  const creating =
    pathname === `${section.prefix}/nueva` ||
    pathname === `${section.prefix}/nuevo` ||
    pathname.startsWith(`${section.prefix}/nueva/`);
  if (creating && !can(permissions, section.module, "crear")) return "deny";
  return "allow";
}

export function showsAccountCard(permissions: Iterable<string>, side: "clientes" | "proveedores"): boolean {
  return can(permissions, "cuentas_corrientes", "ver") && can(permissions, side, "ver");
}

export function dashboardWidgets(permissions: Iterable<string>): string[] {
  const widgets: string[] = [];
  if (can(permissions, "ventas", "ver")) widgets.push("ventas");
  if (can(permissions, "compras", "ver")) widgets.push("compras");
  if (can(permissions, "caja", "ver")) widgets.push("caja");
  if (showsAccountCard(permissions, "clientes")) widgets.push("clientes");
  if (showsAccountCard(permissions, "proveedores")) widgets.push("proveedores");
  if (can(permissions, "stock", "ver")) widgets.push("stock");
  return widgets;
}

export function estacionTabs(permissions: Iterable<string>): string[] {
  const tabs = ["playa"];
  if (can(permissions, "estacion", "editar")) tabs.push("tanques", "precios", "equipos");
  if (can(permissions, "estacion", "crear") || can(permissions, "estacion", "editar")) tabs.push("flota");
  if (can(permissions, "informes", "ver")) tabs.push("informes");
  return tabs;
}

export function ownTrucks<T extends { id: string }>(
  trucks: T[],
  trips: { truckId: string; driverUserId: string | null }[],
  userId: string,
  ownOnly: boolean,
): T[] {
  if (!ownOnly) return trucks;
  const ids = new Set(trips.filter((trip) => trip.driverUserId === userId).map((trip) => trip.truckId));
  return trucks.filter((truck) => ids.has(truck.id));
}
