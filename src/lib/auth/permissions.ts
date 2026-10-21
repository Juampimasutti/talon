export const ACTIONS = ["ver", "crear", "editar", "anular", "importar", "exportar"] as const;
export type Action = (typeof ACTIONS)[number];

export const MODULES = [
  { key: "dashboard", label: "Tablero", hint: "Ventas del mes, caja y pendientes", toggle: false },
  { key: "clientes", label: "Clientes", hint: "Fichas, CUIT y condición frente al IVA", toggle: true },
  { key: "proveedores", label: "Proveedores", hint: "A quién le compramos", toggle: true },
  { key: "articulos", label: "Artículos", hint: "Listas de precios, rubros y alícuotas", toggle: true },
  { key: "ventas", label: "Ventas", hint: "Facturas y notas de crédito", toggle: true },
  { key: "compras", label: "Compras", hint: "Facturas de proveedores", toggle: true },
  { key: "pedidos", label: "Pedidos", hint: "Lo que todavía no se entregó", toggle: true },
  { key: "remitos", label: "Remitos", hint: "Entregas que mueven el depósito", toggle: true },
  { key: "stock", label: "Stock", hint: "Existencias por depósito", toggle: true },
  { key: "caja", label: "Caja", hint: "Ingresos, egresos y cobranzas", toggle: true },
  { key: "cuentas_corrientes", label: "Cuentas corrientes", hint: "Quién debe y a quién le debemos", toggle: true },
  { key: "contabilidad", label: "Plan de cuentas", hint: "Cuentas para imputar", toggle: true },
  { key: "comprobantes", label: "Comprobantes", hint: "Tipos, letras y numeración", toggle: true },
  { key: "estacion", label: "Estación de servicio", hint: "Surtidores, tanques, turnos y flota", toggle: true },
  { key: "constructora", label: "Constructora", hint: "Obras, certificados, costos y unidades", toggle: true },
  { key: "inmobiliaria", label: "Inmobiliaria", hint: "Propiedades, contratos y liquidaciones", toggle: true },
  { key: "reparto", label: "Reparto", hint: "Camiones propios y entrega a granel", toggle: true },
  { key: "informes", label: "Informes", hint: "Ventas, IVA, caja, stock y rentabilidad", toggle: true },
  { key: "auditoria", label: "Auditoría", hint: "Quién hizo cada cosa", toggle: true },
  { key: "configuracion", label: "Configuración", hint: "Empresa, módulos, roles y campos", toggle: false },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export function permissionKey(moduleKey: string, action: string): string {
  return `${moduleKey}.${action}`;
}

export function actionApplies(moduleKey: string, action: string): boolean {
  if (moduleKey === "dashboard") return action === "ver";
  if (moduleKey === "auditoria") return action === "ver" || action === "exportar";
  return true;
}

export function allPermissions(): string[] {
  const keys: string[] = [];
  for (const moduleKey of MODULES) {
    for (const action of ACTIONS) {
      if (actionApplies(moduleKey.key, action)) keys.push(permissionKey(moduleKey.key, action));
    }
  }
  return keys;
}

function readExport(modules: readonly string[]): string[] {
  return modules.flatMap((moduleKey) => [permissionKey(moduleKey, "ver"), permissionKey(moduleKey, "exportar")]);
}

const OPERATIONAL = MODULES.map((moduleKey) => moduleKey.key).filter((key) => key !== "dashboard");

export const ROLE_TEMPLATES: Record<string, { name: string; description: string; permissions: string[] }> = {
  admin: {
    name: "Administración",
    description: "Maneja la empresa completa.",
    permissions: allPermissions(),
  },
  vendedor: {
    name: "Vendedor de mostrador",
    description: "Vende, toma pedidos y atiende la ficha del cliente. No entra a compras ni a la configuración.",
    permissions: [
      "dashboard.ver",
      "clientes.ver",
      "clientes.crear",
      "clientes.editar",
      "clientes.importar",
      "clientes.exportar",
      "articulos.ver",
      "ventas.ver",
      "ventas.crear",
      "ventas.editar",
      "ventas.anular",
      "ventas.importar",
      "ventas.exportar",
      "pedidos.ver",
      "pedidos.crear",
      "pedidos.editar",
      "pedidos.anular",
      "pedidos.importar",
      "remitos.ver",
      "remitos.crear",
      "remitos.importar",
      "cuentas_corrientes.ver",
    ],
  },
  cajero: {
    name: "Caja",
    description: "Cobra, mira la caja y consulta ventas.",
    permissions: [
      "dashboard.ver",
      "clientes.ver",
      "ventas.ver",
      "caja.ver",
      "caja.crear",
      "caja.editar",
      "caja.anular",
      "caja.exportar",
      "cuentas_corrientes.ver",
      "cuentas_corrientes.crear",
    ],
  },
  deposito: {
    name: "Depósito",
    description: "Prepara pedidos, emite remitos y ajusta existencias.",
    permissions: [
      "dashboard.ver",
      "clientes.ver",
      "articulos.ver",
      "pedidos.ver",
      "remitos.ver",
      "remitos.crear",
      "remitos.editar",
      "remitos.anular",
      "remitos.importar",
      "stock.ver",
      "stock.crear",
      "stock.editar",
      "stock.importar",
      "stock.exportar",
    ],
  },
  compras: {
    name: "Compras",
    description: "Carga facturas de proveedores y actualiza artículos.",
    permissions: [
      "dashboard.ver",
      "proveedores.ver",
      "proveedores.crear",
      "proveedores.editar",
      "proveedores.importar",
      "proveedores.exportar",
      "articulos.ver",
      "articulos.crear",
      "articulos.editar",
      "articulos.importar",
      "articulos.exportar",
      "compras.ver",
      "compras.crear",
      "compras.editar",
      "compras.anular",
      "compras.importar",
      "compras.exportar",
      "stock.ver",
      "cuentas_corrientes.ver",
    ],
  },
  playero: {
    name: "Playero",
    description: "Carga el aforador y los vales de su propio turno. No toca precios ni tanques.",
    permissions: ["dashboard.ver", "estacion.ver", "estacion.crear", "articulos.ver"],
  },
  encargado: {
    name: "Encargado de playa",
    description: "Cierra turnos, mide tanques, cambia precios y factura la flota.",
    permissions: [
      "dashboard.ver",
      "estacion.ver",
      "estacion.crear",
      "estacion.editar",
      "estacion.anular",
      "estacion.exportar",
      "reparto.ver",
      "reparto.crear",
      "reparto.editar",
      "reparto.exportar",
      "informes.ver",
      "informes.exportar",
      "clientes.ver",
      "clientes.crear",
      "articulos.ver",
      "ventas.ver",
      "ventas.crear",
      "remitos.ver",
      "remitos.crear",
      "caja.ver",
      "caja.crear",
      "caja.editar",
      "stock.ver",
      "stock.crear",
      "cuentas_corrientes.ver",
      "proveedores.ver",
    ],
  },
  chofer: {
    name: "Chofer",
    description: "Carga su camión, entrega en ruta y anota los kilómetros.",
    permissions: ["dashboard.ver", "estacion.ver", "reparto.ver", "reparto.crear", "remitos.ver", "remitos.crear"],
  },
  contador: {
    name: "Contador",
    description: "Consulta y exporta. No carga ni anula.",
    permissions: ["dashboard.ver", ...readExport(OPERATIONAL), "contabilidad.crear", "contabilidad.editar"],
  },
};

export function can(permissions: Iterable<string>, moduleKey: string, action: string): boolean {
  if (permissions instanceof Set) return permissions.has(permissionKey(moduleKey, action));
  for (const permission of permissions) {
    if (permission === permissionKey(moduleKey, action)) return true;
  }
  return false;
}

export function moduleEnabled(enabled: readonly string[], moduleKey: string): boolean {
  if (moduleKey === "contabilidad") return false; // No hay asientos automáticos todavía.
  if (moduleKey === "dashboard" || moduleKey === "configuracion") return true;
  return enabled.includes(moduleKey);
}

export function visibleModules(enabled: readonly string[], permissions: Iterable<string>) {
  return MODULES.filter((moduleKey) => moduleEnabled(enabled, moduleKey.key) && can(permissions, moduleKey.key, "ver"));
}

export function permissionDelta(current: readonly string[], next: readonly string[]): { grant: string[]; revoke: string[] } {
  const wanted = new Set(next);
  const have = new Set(current);
  return {
    grant: next.filter((permission) => !have.has(permission)),
    revoke: current.filter((permission) => !wanted.has(permission)),
  };
}
