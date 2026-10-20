import { describe, expect, it } from "vitest";
import { rateLabel } from "./labels";
import { calcDocument, calcLine, documentPerceptions, previewKeepsVat, previewPriceMode } from "./totals";

describe("cálculo de comprobantes", () => {
  it("en factura A suma el IVA sobre el neto", () => {
    const line = calcLine(
      { quantity: 2, unitPriceCents: 10_000, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado" },
      "net",
    );
    expect(line).toMatchObject({ netCents: 20_000, vatCents: 4200, totalCents: 24_200 });
  });

  it("en factura B parte el precio final", () => {
    const line = calcLine(
      { quantity: 1, unitPriceCents: 12_100, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado" },
      "gross",
    );
    expect(line.netCents + line.vatCents).toBe(line.totalCents);
    expect(line).toMatchObject({ netCents: 10_000, vatCents: 2100, totalCents: 12_100 });
  });

  it("aplica descuento, exento, no gravado y percepción de IIBB", () => {
    const totals = calcDocument({
      priceMode: "net",
      otherTaxesCents: 100,
      perceptions: [{ name: "Percepción IIBB", rateBps: 300 }],
      lines: [
        { quantity: 1, unitPriceCents: 10_000, discountBps: 1000, ivaRateBps: 2100, taxTreatment: "gravado" },
        { quantity: 2, unitPriceCents: 5_000, discountBps: 0, ivaRateBps: 1050, taxTreatment: "gravado" },
        { quantity: 1, unitPriceCents: 2_000, discountBps: 0, ivaRateBps: 2100, taxTreatment: "exento" },
        { quantity: 1, unitPriceCents: 3_000, discountBps: 0, ivaRateBps: 2100, taxTreatment: "no_gravado" },
      ],
    });

    expect(totals.lines[0]).toMatchObject({ netCents: 9000, vatCents: 1890, totalCents: 10_890 });
    expect(totals.netTaxedCents).toBe(19_000);
    expect(totals.vatCents).toBe(1890 + 1050);
    expect(totals.exemptCents).toBe(2_000);
    expect(totals.netUntaxedCents).toBe(3_000);
    expect(totals.perceptionsCents).toBe(570);
    expect(totals.totalCents).toBe(19_000 + 3_000 + 2_000 + 2940 + 570 + 100);
    expect(totals.vatBreakdown).toEqual([
      { rateBps: 2100, netCents: 9000, vatCents: 1890 },
      { rateBps: 1050, netCents: 10_000, vatCents: 1050 },
    ]);
  });

  it("el pedido y el remito discriminan el IVA del artículo", () => {
    expect(previewPriceMode("pedido", false, null)).toBe("net");
    expect(previewPriceMode("remito", false, null)).toBe("net");
    expect(previewKeepsVat("pedido", false)).toBe(true);
    expect(previewKeepsVat("venta", false)).toBe(false);
    expect(previewPriceMode("venta", true, "C")).toBe("sin_iva");
    const totals = calcDocument({
      priceMode: previewPriceMode("pedido", false, null),
      lines: [{ quantity: 1, unitPriceCents: 46_071, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado" }],
    });
    expect(totals.netTaxedCents).toBe(46_071);
    expect(totals.netUntaxedCents).toBe(0);
    expect(totals.vatCents).toBe(Math.round((46_071 * 2100) / 10_000));
    expect(totals.totalCents).toBe(totals.netTaxedCents + totals.vatCents);
    expect(totals.vatBreakdown).toEqual([{ rateBps: 2100, netCents: 46_071, vatCents: totals.vatCents }]);
    expect(`IVA ${rateLabel(totals.vatBreakdown[0].rateBps)}`).toBe("IVA 21%");
    expect(documentPerceptions({ kind: "venta", partyBps: 300 })).toEqual([{ name: "Percepción IIBB", rateBps: 300 }]);
    expect(documentPerceptions({ kind: "pedido", partyBps: 300 })).toEqual([{ name: "Percepción IIBB", rateBps: 300 }]);
    expect(documentPerceptions({ kind: "remito", partyBps: 300 })).toEqual([{ name: "Percepción IIBB", rateBps: 300 }]);
    expect(documentPerceptions({ kind: "compra", partyBps: 300 })).toEqual([]);
    expect(documentPerceptions({ kind: "venta", partyBps: 300, explicit: [{ name: "Percepción IIBB", rateBps: 500 }] })[0].rateBps).toBe(500);
  });

  it("en factura C no discrimina IVA", () => {
    const totals = calcDocument({
      priceMode: "sin_iva",
      lines: [{ quantity: 3, unitPriceCents: 1500, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado" }],
    });
    expect(totals.vatCents).toBe(0);
    expect(totals.netUntaxedCents).toBe(4500);
    expect(totals.totalCents).toBe(4500);
  });
});
