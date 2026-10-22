import { describe, expect, it } from "vitest";
import { MODULES, ROLE_TEMPLATES, allPermissions, can, moduleEnabled, permissionDelta, visibleModules } from "./permissions";

describe("permisos", () => {
  it("el vendedor no ve compras ni configuración", () => {
    const permissions = ROLE_TEMPLATES.vendedor.permissions;
    expect(can(permissions, "compras", "ver")).toBe(false);
    expect(can(permissions, "configuracion", "ver")).toBe(false);
    expect(can(permissions, "proveedores", "ver")).toBe(false);
    expect(can(permissions, "ventas", "crear")).toBe(true);
    expect(can(permissions, "ventas", "importar")).toBe(true);
    expect(can(permissions, "compras", "importar")).toBe(false);
    expect(can(permissions, "clientes", "editar")).toBe(true);
    const menu = visibleModules(
      ["clientes", "ventas", "compras", "pedidos", "articulos", "remitos", "cuentas_corrientes"],
      permissions,
    ).map((item) => item.key);
    expect(menu).not.toContain("compras");
    expect(menu).not.toContain("configuracion");
    expect(menu).toContain("ventas");
  });

  it("el contador solo mira y exporta", () => {
    const permissions = ROLE_TEMPLATES.contador.permissions;
    expect(permissions.filter((item) => item.endsWith(".crear") || item.endsWith(".editar"))).toEqual(["contabilidad.crear", "contabilidad.editar"]);
    expect(permissions.some((item) => item.endsWith(".anular") || item.endsWith(".importar"))).toBe(false);
    expect(can(permissions, "ventas", "ver")).toBe(true);
    expect(can(permissions, "ventas", "exportar")).toBe(true);
    expect(can(permissions, "auditoria", "ver")).toBe(true);
  });

  it("cada puesto usa permisos que existen y el admin los tiene todos", () => {
    const universe = new Set(allPermissions());
    for (const role of Object.values(ROLE_TEMPLATES)) {
      for (const permission of role.permissions) expect(universe.has(permission)).toBe(true);
    }
    expect(ROLE_TEMPLATES.admin.permissions).toHaveLength(universe.size);
  });

  it("el playero carga su playa y el encargado no entra a configuración", () => {
    expect(can(ROLE_TEMPLATES.playero.permissions, "estacion", "crear")).toBe(true);
    expect(can(ROLE_TEMPLATES.playero.permissions, "estacion", "editar")).toBe(false);
    expect(can(ROLE_TEMPLATES.playero.permissions, "ventas", "ver")).toBe(false);
    const menu = visibleModules(["estacion", "clientes", "articulos", "ventas"], ROLE_TEMPLATES.playero.permissions).map((item) => item.key);
    expect(menu).toContain("estacion");
    expect(menu).toContain("articulos");
    expect(menu).not.toContain("ventas");
    expect(menu).not.toContain("clientes");
    expect(can(ROLE_TEMPLATES.playero.permissions, "clientes", "ver")).toBe(false);
    const chofer = visibleModules(["estacion", "clientes", "reparto", "ventas"], ROLE_TEMPLATES.chofer.permissions).map((item) => item.key);
    expect(chofer).toEqual(["dashboard", "estacion", "reparto"]);
    expect(can(ROLE_TEMPLATES.chofer.permissions, "clientes", "ver")).toBe(false);
    expect(can(ROLE_TEMPLATES.encargado.permissions, "estacion", "editar")).toBe(true);
    expect(can(ROLE_TEMPLATES.encargado.permissions, "ventas", "crear")).toBe(true);
    expect(can(ROLE_TEMPLATES.encargado.permissions, "configuracion", "ver")).toBe(false);
    expect(can(ROLE_TEMPLATES.chofer.permissions, "reparto", "crear")).toBe(true);
    expect(can(ROLE_TEMPLATES.chofer.permissions, "estacion", "crear")).toBe(false);
    expect(can(ROLE_TEMPLATES.encargado.permissions, "reparto", "editar")).toBe(true);
    expect(can(ROLE_TEMPLATES.encargado.permissions, "caja", "crear")).toBe(true);
  });

  it("el menú de cada puesto es exactamente lo que puede ver", () => {
    const enabled = MODULES.map((moduleKey) => moduleKey.key);
    for (const [key, role] of Object.entries(ROLE_TEMPLATES)) {
      const menu = visibleModules(enabled, role.permissions).map((item) => item.key);
      for (const item of menu) expect(can(role.permissions, item, "ver"), `${key} ${item}`).toBe(true);
      for (const moduleKey of MODULES) {
        const shown = moduleEnabled(enabled, moduleKey.key) && can(role.permissions, moduleKey.key, "ver");
        expect(menu.includes(moduleKey.key), `${key} ${moduleKey.key}`).toBe(shown);
      }
    }
    expect(permissionDelta(["clientes.ver", "estacion.ver"], ROLE_TEMPLATES.playero.permissions).revoke).toEqual(["clientes.ver"]);
  });

  it("un módulo apagado no se muestra aunque el rol pueda verlo", () => {
    expect(moduleEnabled(["ventas"], "compras")).toBe(false);
    expect(moduleEnabled(["ventas"], "impuestos")).toBe(false);
    expect(visibleModules(["ventas"], ROLE_TEMPLATES.admin.permissions).map((item) => item.key)).not.toContain("impuestos");
    expect(visibleModules(["ventas", "impuestos"], ROLE_TEMPLATES.admin.permissions).map((item) => item.key)).toContain("impuestos");
    expect(moduleEnabled(["ventas"], "dashboard")).toBe(true);
    expect(moduleEnabled([], "configuracion")).toBe(true);
  });

  it("crea los seis permisos de impuestos y limita al contador a lectura", () => {
    expect(allPermissions().filter((permission) => permission.startsWith("impuestos."))).toEqual([
      "impuestos.ver",
      "impuestos.crear",
      "impuestos.editar",
      "impuestos.anular",
      "impuestos.importar",
      "impuestos.exportar",
    ]);
    expect(can(ROLE_TEMPLATES.contador.permissions, "impuestos", "ver")).toBe(true);
    expect(can(ROLE_TEMPLATES.contador.permissions, "impuestos", "exportar")).toBe(true);
    expect(can(ROLE_TEMPLATES.contador.permissions, "impuestos", "crear")).toBe(false);
  });

  it("caja, depósito y compras quedan en su carril", () => {
    expect(can(ROLE_TEMPLATES.cajero.permissions, "compras", "ver")).toBe(false);
    expect(can(ROLE_TEMPLATES.cajero.permissions, "caja", "crear")).toBe(true);
    expect(can(ROLE_TEMPLATES.deposito.permissions, "ventas", "crear")).toBe(false);
    expect(can(ROLE_TEMPLATES.deposito.permissions, "remitos", "crear")).toBe(true);
    expect(can(ROLE_TEMPLATES.compras.permissions, "ventas", "crear")).toBe(false);
    expect(can(ROLE_TEMPLATES.compras.permissions, "compras", "anular")).toBe(true);
  });
});
