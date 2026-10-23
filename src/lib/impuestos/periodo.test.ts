import { describe, expect, it } from "vitest";
import { esErrorPeriodoCerrado, mensajePeriodoCerrado, periodoSchema, reglaFechaImportada } from "./periodo";

describe("períodos de IVA", () => {
  it("acepta meses reales y un rango de años razonable", () => {
    expect(periodoSchema.safeParse("202609").success).toBe(true);
    for (const value of ["202600", "202613", "199912", "210101", "abc"]) expect(periodoSchema.safeParse(value).success).toBe(false);
  });
  it("aplica las reglas de fecha de ventas y compras", () => {
    expect(reglaFechaImportada("ventas", "2026-09-15", "202610")).toEqual({ rechazo: "Fecha fuera del período" });
    expect(reglaFechaImportada("compras", "2026-11-01", "202610")).toEqual({ rechazo: "Fecha fuera del período" });
    expect(reglaFechaImportada("compras", "2026-09-15", "202610").aviso).toContain("período anterior");
    expect(reglaFechaImportada("compras", "2026-10-15", "202610")).toEqual({});
  });
  it("traduce el guard de PostgreSQL", () => {
    expect(esErrorPeriodoCerrado({ cause: { code: "55000" } })).toBe(true);
    expect(mensajePeriodoCerrado("202609")).toBe("El período 09/2026 está confirmado. Reabrilo para importar.");
  });
});
