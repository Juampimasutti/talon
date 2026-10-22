import { describe, expect, it } from "vitest";
import { effectiveModules, IMPUESTOS_HIDDEN_SECTORS, moduleOfferedForCompany } from "./permissions";

describe("Impuestos según rubro", () => {
  it("claves exactas ocultas", () => expect([...IMPUESTOS_HIDDEN_SECTORS]).toEqual(["comercio", "estacion"]));
  it("negocio comercio/estación: no se ofrece", () => {
    expect(moduleOfferedForCompany("impuestos", { tipo: "negocio", businessSector: "comercio" })).toBe(false);
    expect(moduleOfferedForCompany("impuestos", { tipo: "negocio", businessSector: "estacion" })).toBe(false);
    expect(moduleOfferedForCompany("impuestos", { tipo: "negocio", businessSector: null })).toBe(false);
  });
  it("inmobiliaria/constructora y estudio: sí", () => {
    expect(moduleOfferedForCompany("impuestos", { tipo: "negocio", businessSector: "inmobiliaria" })).toBe(true);
    expect(moduleOfferedForCompany("impuestos", { tipo: "negocio", businessSector: "constructora" })).toBe(true);
    expect(moduleOfferedForCompany("impuestos", { tipo: "estudio", businessSector: "comercio" })).toBe(true);
    expect(moduleOfferedForCompany("impuestos", { tipo: "estudio", businessSector: null })).toBe(true);
    expect(moduleOfferedForCompany("impuestos", { tipo: "estudio" })).toBe(true);
  });
  it("no toca otros módulos", () => {
    expect(effectiveModules(["ventas", "impuestos", "stock"], { tipo: "negocio", businessSector: "comercio" })).toEqual(["ventas", "stock"]);
    expect(effectiveModules(["impuestos"], { tipo: "estudio", businessSector: "comercio" })).toEqual(["impuestos"]);
    expect(effectiveModules(["impuestos"], { tipo: "estudio", businessSector: null })).toEqual(["impuestos"]);
    expect(effectiveModules(["impuestos"], { tipo: "estudio" })).toEqual(["impuestos"]);
  });
});
