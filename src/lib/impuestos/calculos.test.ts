import { describe, expect, it } from "vitest";
import { aplicarProrrateo, calcularLiquidacion, coeficienteProrrateo, itemsLiquidacion, periodoAnterior, saldosQueArrastra } from "./calculos";

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

  it("mantiene separados saldo técnico y libre disponibilidad", () => {
    // Saldo técnico negativo: las percepciones NO lo compensan, quedan como libre disponibilidad.
    const r = calcularLiquidacion([{ libro: "ventas", ivaCents: 100_000 }, { libro: "compras", ivaCents: 300_000, percepIvaCents: 50_000 }], { saldoLibreAnteriorCents: 10_000, retencionesCents: 5_000 });
    expect(r.saldoTecnicoAFavorCents).toBe(200_000);
    expect(r.saldoLibreAFavorCents).toBe(65_000);
    expect(r.totalPagarCents).toBe(0);
  });

  it("arrastra saldos de la liquidación confirmada anterior", () => {
    expect(periodoAnterior("202609")).toBe("202608");
    expect(periodoAnterior("202601")).toBe("202512");
    expect(saldosQueArrastra({ saldoTecnicoAFavorCents: 200_000, saldoLibreAFavorCents: 0 })).toMatchObject({ saldoTecnicoAnteriorCents: 200_000, saldoLibreAnteriorCents: 0 });
    expect(saldosQueArrastra({ saldoFavorCents: 7 })).toMatchObject({ saldoLibreAnteriorCents: 7, formatoViejo: true });
  });

  it("items en orden del formulario", () => {
    const r = calcularLiquidacion([{ libro: "ventas", ivaCents: 1_000 }], { retencionesCents: 100 });
    const items = itemsLiquidacion(r, { retenciones: true });
    expect(items.find((i) => i.concepto === "Retenciones de IVA")).toMatchObject({ importeCents: 100, origen: "manual" });
    expect(items.at(-2)).toMatchObject({ concepto: "Saldo a pagar", importeCents: 900 });
  });

  it("calcula y aplica el prorrateo half-up", () => {
    const coefficient = coeficienteProrrateo(15_000_000, 5_000_000, 0);
    expect(coefficient).toBe(7_500);
    expect(aplicarProrrateo(270_000, coefficient)).toBe(202_500);
    expect(coeficienteProrrateo(0, 0, 0)).toBe(10_000);
  });

  it("convierte moneda extranjera por alícuota antes de liquidar", () => {
    const result = calcularLiquidacion([
      { libro: "compras", ivaCents: 21_000, creditoComputableCents: 21_000, tipoCambio: 1050.5 },
    ]);
    expect(result.creditoComprasCents).toBe(22_060_500);
  });
});
