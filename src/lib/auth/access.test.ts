import { describe, expect, it } from "vitest";
import { dashboardWidgets, estacionTabs, ownTrucks, sectionAccess } from "./access";
import { ROLE_TEMPLATES } from "./permissions";

const MODULES = [
  "clientes", "proveedores", "articulos", "ventas", "compras", "pedidos", "remitos", "stock", "caja",
  "cuentas_corrientes", "contabilidad", "comprobantes", "estacion", "reparto", "informes", "auditoria",
];

const MATRIX: [string, string, "allow" | "deny"][] = [
  ["contador", "/ventas/nueva", "deny"],
  ["contador", "/compras/nueva", "deny"],
  ["contador", "/ventas", "allow"],
  ["contador", "/compras/123", "allow"],
  ["cajero", "/ventas/nueva", "deny"],
  ["cajero", "/ventas", "allow"],
  ["cajero", "/caja", "allow"],
  ["vendedor", "/ventas/nueva", "allow"],
  ["vendedor", "/compras", "deny"],
  ["vendedor", "/compras/nueva", "deny"],
  ["compras", "/compras/nueva", "allow"],
  ["compras", "/ventas/nueva", "deny"],
  ["deposito", "/remitos/nueva", "allow"],
  ["deposito", "/remitos/nuevo", "allow"],
  ["contador", "/pedidos/nuevo", "deny"],
  ["deposito", "/ventas/nueva", "deny"],
  ["playero", "/estacion", "allow"],
  ["playero", "/estacion/equipos", "deny"],
  ["encargado", "/estacion/equipos", "allow"],
  ["playero", "/ventas", "deny"],
  ["playero", "/clientes", "deny"],
  ["playero", "/articulos", "allow"],
  ["chofer", "/reparto", "allow"],
  ["chofer", "/informes", "deny"],
  ["chofer", "/clientes", "deny"],
  ["chofer", "/estacion", "allow"],
  ["admin", "/compras/nueva", "allow"],
];

describe("matriz de puestos", () => {
  it("deja entrar o redirige según ver y crear", () => {
    for (const [role, path, expected] of MATRIX) {
      expect(sectionAccess(path, ROLE_TEMPLATES[role].permissions, MODULES), `${role} ${path}`).toBe(expected);
    }
  });

  it("el tablero no mezcla clientes y proveedores", () => {
    expect(dashboardWidgets(ROLE_TEMPLATES.vendedor.permissions)).toEqual(["ventas", "clientes"]);
    expect(dashboardWidgets(ROLE_TEMPLATES.compras.permissions)).not.toContain("clientes");
    expect(dashboardWidgets(ROLE_TEMPLATES.compras.permissions)).toContain("proveedores");
    expect(dashboardWidgets(ROLE_TEMPLATES.cajero.permissions)).toContain("caja");
    expect(dashboardWidgets(ROLE_TEMPLATES.cajero.permissions)).toContain("ventas");
    expect(dashboardWidgets(ROLE_TEMPLATES.cajero.permissions)).not.toContain("compras");
    expect(dashboardWidgets(ROLE_TEMPLATES.playero.permissions)).not.toContain("ventas");
    expect(dashboardWidgets(ROLE_TEMPLATES.playero.permissions)).not.toContain("clientes");
    expect(dashboardWidgets(ROLE_TEMPLATES.deposito.permissions)).not.toContain("clientes");
    expect(dashboardWidgets(ROLE_TEMPLATES.chofer.permissions)).not.toContain("clientes");
    expect(dashboardWidgets(ROLE_TEMPLATES.cajero.permissions)).toContain("clientes");
  });

  it("la estación muestra las pestañas del puesto", () => {
    expect(estacionTabs(ROLE_TEMPLATES.playero.permissions)).toEqual(["playa", "flota"]);
    expect(estacionTabs(ROLE_TEMPLATES.chofer.permissions)).toEqual(["playa"]);
    expect(estacionTabs(ROLE_TEMPLATES.encargado.permissions)).toEqual(["playa", "tanques", "precios", "equipos", "flota", "informes"]);
  });

  it("el chofer ve solo su camión", () => {
    const trucks = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const trips = [{ truckId: "a", driverUserId: "oscar" }];
    expect(ownTrucks(trucks, trips, "oscar", true).map((truck) => truck.id)).toEqual(["a"]);
    expect(ownTrucks(trucks, trips, "oscar", false)).toHaveLength(3);
  });

  it("un módulo apagado no es un 404", () => {
    expect(sectionAccess("/remitos", ROLE_TEMPLATES.admin.permissions, ["ventas"])).toBe("module-off");
  });
});
