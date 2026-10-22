import { describe, expect, it } from "vitest";
import { aplicarProrrateo, calcularLiquidacion, coeficienteProrrateo } from "./calculos";

describe("liquidación IVA", () => {
  it("reproduce el ejemplo de la sección 7", () => {
    const result = calcularLiquidacion([
      { libro: "ventas", ivaCents: 2_100_000 },
      { libro: "ventas", ivaCents: 525_000 },
      { libro: "ventas", ivaCents: 210_000, signo: -1 },
      { libro: "compras", ivaCents: 1_260_000, percepIvaCents: 180_000 },
      { libro: "compras", ivaCents: 270_000 },
      { libro: "compras", ivaCents: 0 },
    ], { saldoTecnicoAnteriorCents: 200_000 });
    expect(result).toMatchObject({
      debitoFiscalCents: 2_415_000,
      creditoFiscalCents: 1_530_000,
      totalPagarCents: 505_000,
    });
  });

  it("calcula y aplica el prorrateo half-up", () => {
    const coefficient = coeficienteProrrateo(15_000_000, 5_000_000, 0);
    expect(coefficient).toBe(7_500);
    expect(aplicarProrrateo(270_000, coefficient)).toBe(202_500);
  });
});
