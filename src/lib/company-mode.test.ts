import { describe, expect, it } from "vitest";
import { createCompanySchema, defaultCompanyMode, modulesForMode, ESTUDIO_FUTURE_MODULES } from "./company-setup";
import { MODULES, moduleToggleDelta } from "./auth/permissions";

describe("modo negocio / estudio", () => {
  it("TALON_MODO elige el modo por defecto; sin variable es negocio", () => {
    expect(defaultCompanyMode({})).toBe("negocio");
    expect(defaultCompanyMode({ TALON_MODO: " Estudio " })).toBe("estudio");
    expect(defaultCompanyMode({ TALON_MODO: "otro" })).toBe("negocio");
  });
  it("estudio fuerza sólo impuestos; negocio respeta lo pedido", () => {
    expect(modulesForMode("estudio", ["ventas", "stock", "informes"])).toEqual(["impuestos"]);
    expect(modulesForMode("negocio", ["ventas"])).toEqual(["ventas"]);
  });
  it("sueldos es un placeholder: no es un módulo habilitable", () => {
    expect(ESTUDIO_FUTURE_MODULES.map((item) => item.key)).toContain("sueldos");
    const sueldos = MODULES.find((item) => (item.key as string) === "sueldos");
    expect(sueldos).toMatchObject({ label: "Sueldos", available: false });
  });
  it("el alta acepta tipo y lo deja opcional", () => {
    const base = { name: "E", legalName: "E SA", cuit: "20-12345678-6", taxCondition: "ri", address: "x", activityStartedOn: "2020-01-01", businessSector: "comercio", pointsOfSale: [1], enabledModules: ["impuestos"] };
    expect(createCompanySchema.safeParse({ ...base, tipo: "estudio" }).success).toBe(true);
    expect(createCompanySchema.safeParse({ ...base, tipo: "otro" }).success).toBe(false);
  });
  it("calcula módulos prendidos y apagados para auditar", () => {
    expect(moduleToggleDelta(["ventas", "stock"], ["stock", "impuestos"])).toEqual({ turnedOn: ["impuestos"], turnedOff: ["ventas"] });
  });
});
