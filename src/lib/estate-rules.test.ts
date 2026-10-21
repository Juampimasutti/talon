import { describe, expect, it } from "vitest";
import { addMonths, leasePenalty, settlementAmounts } from "./estate-rules";

describe("alquileres configurables", () => {
  it("sin tasas no inventa comisiones ni punitorios", () => {
    expect(leasePenalty(100_000, 0, "2026-01-01", "2026-02-01", 0)).toBe(0);
    expect(settlementAmounts(100_000, 20_000, 0, 2100, 0)).toEqual({
      commission: 0,
      totalCommission: 0,
      payable: 120_000,
    });
  });
  it("comisión sólo sobre alquiler cobrado; IVA y gastos se descuentan una vez", () => {
    expect(settlementAmounts(100_000, 20_000, 1000, 2100, 5000)).toEqual({
      commission: 10_000,
      totalCommission: 12_100,
      payable: 102_900,
    });
  });
  it("mora diaria simple respeta vencimiento y gracia", () => {
    expect(leasePenalty(100_000, 10, "2026-01-10", "2026-01-15", 2)).toBe(300);
    expect(leasePenalty(100_000, 10, "2026-01-10", "2026-01-09", 0)).toBe(0);
  });
  it("meses de ajuste no saltean febrero", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});
