import { describe, expect, it } from "vitest";
import { amountForVolume, fuelSaleDraft, fuelShown, inPeriod, litersSold, oneTaxPerCode, openingAfterReset, priceAt, pumpInvoiceParts, reconcileTank, shiftBoard, shiftGap, splitGrossSale, splitPumpSale, windowLiters, withinCapacity } from "./calc";
import { calcDocument } from "../fiscal/totals";

const taxes = [
  { code: "itc", name: "ITC", centsPerUnit: 15_000, inVatBase: false, treatment: "interno" as const },
  { code: "co2", name: "Impuesto al CO2", centsPerUnit: 2_500, inVatBase: false, treatment: "no_gravado" as const },
];

describe("estación", () => {
  it("calcula litros y monto del aforador", () => {
    expect(litersSold(10234.5, 10434.8)).toBe(200.3);
    expect(amountForVolume(200.3, 120_000)).toBe(24_036_000);
    expect(() => litersSold(100, 90)).toThrow(/cierre/);
  });

  it("parte el precio de surtidor sin meter ITC ni CO2 en la base del IVA", () => {
    const split = splitPumpSale({ quantity: 10, pumpPriceCents: 120_000, ivaRateBps: 2100, taxes });
    expect(split.grossCents).toBe(1_200_000);
    expect(split.taxes.map((tax) => tax.amountCents)).toEqual([150_000, 25_000]);
    expect(split.vatBaseCents + split.vatCents + split.taxCents).toBe(split.grossCents);
    expect(split.totalCents).toBe(1_200_000);
    expect(split.vatBaseCents + split.vatCents).toBe(1_025_000);
    expect(Math.abs(split.vatCents - Math.round((split.vatBaseCents * 2100) / 10_000))).toBeLessThanOrEqual(1);
  });

  it("concilia el tanque y muestra la merma", () => {
    const result = reconcileTank({ previousStick: 10_000, deliveries: 5_000, sold: 200.3, currentStick: 14_790 });
    expect(result.theoretical).toBe(14_799.7);
    expect(result.variance).toBe(-9.7);
    expect(result.shrinkage).toBe(9.7);
  });

  it("deja afuera del teórico lo que pasó después de la varilla, aunque el texto de la fecha no sea ISO", () => {
    const from = "2026-10-19 10:00:00+00";
    const to = "2026-10-19 18:00:00+00";
    expect(inPeriod("2026-10-19 16:23:00+00", from, to)).toBe(true);
    expect(inPeriod("2026-10-19T19:00:00.000Z", from, to)).toBe(false);
    const deliveries = windowLiters(
      [
        { at: "2026-10-19 12:00:00+00", liters: 5_000 },
        { at: "2026-10-19 19:00:00+00", liters: 1_500 },
      ],
      from,
      to,
    );
    const sold = windowLiters(
      [
        { at: "2026-10-19T15:00:00.000Z", liters: 200.3 },
        { at: "2026-10-19 09:00:00+00", liters: 999 },
      ],
      from,
      to,
    );
    expect(deliveries).toBe(5_000);
    expect(sold).toBe(200.3);
    const result = reconcileTank({ previousStick: 10_000, deliveries, sold, currentStick: 14_790 });
    expect(result.theoretical).toBe(14_799.7);
    expect(result.variance).toBe(-9.7);
  });

  it("el remito y la factura de 300,5 litros salen al precio de surtidor, con impuestos", () => {
    const liters = 300.5;
    const pump = 120_000;
    const remito = fuelSaleDraft({ description: "Nafta súper", liters, pumpPriceCents: pump, ivaRateBps: 2100, taxes, invoice: false, sku: "NS" });
    expect(remito.grossCents).toBe(36_060_000);
    expect(remito.line.sku).toBe("NS");
    expect(remito.line.ivaRateBps).toBe(2100);
    expect(remito.line.amountCents).toBeLessThan(36_060_000);
    const remitoDoc = calcDocument({
      priceMode: "net",
      otherTaxesCents: remito.otherTaxesCents,
      lines: [{ quantity: liters, unitPriceCents: 1, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado", amountCents: remito.line.amountCents }],
    });
    expect(remitoDoc.totalCents).toBe(36_060_000);
    expect(remitoDoc.vatCents).toBeGreaterThan(0);
    const factura = fuelSaleDraft({ description: "Nafta súper", liters, pumpPriceCents: pump, ivaRateBps: 2100, taxes, invoice: true });
    const facturaDoc = calcDocument({
      priceMode: "net",
      otherTaxesCents: factura.otherTaxesCents,
      lines: [{ quantity: liters, unitPriceCents: 1, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado", amountCents: factura.line.amountCents }],
    });
    expect(facturaDoc.totalCents).toBe(remito.grossCents);
    expect(facturaDoc.totalCents).not.toBe(30_801_250);
  });

  it("factura el vale a su precio y no duplica ITC ni CO2", () => {
    const duplicated = [...taxes, ...taxes];
    expect(oneTaxPerCode(duplicated)).toHaveLength(2);
    const gross = 40 * 120_000;
    const split = splitGrossSale({ quantity: 40, grossCents: gross, ivaRateBps: 2100, taxes: oneTaxPerCode(duplicated) });
    expect(split.grossCents).toBe(gross);
    expect(split.taxCents).toBe(40 * (15_000 + 2_500));
    expect(split.taxCents).not.toBe(40 * 350_00);
    const parts = pumpInvoiceParts(split, 2100);
    expect(parts.totalCents).toBe(gross);
    expect(parts.otherTaxesCents).toBeLessThanOrEqual(split.taxCents + 1);
    expect(parts.otherTaxesCents).toBeGreaterThanOrEqual(split.taxCents - 1);
  });

  it("redondea el renglón a centavos y el total queda igual al precio de surtidor", () => {
    const split = splitPumpSale({ quantity: 161.137, pumpPriceCents: 120_000, ivaRateBps: 2100, taxes });
    const parts = pumpInvoiceParts(split, 2100);
    expect(parts.totalCents).toBe(split.grossCents);
    const document = calcDocument({
      priceMode: "net",
      otherTaxesCents: parts.otherTaxesCents,
      lines: [{ quantity: split.quantity, unitPriceCents: 1, discountBps: 0, ivaRateBps: 2100, taxTreatment: "gravado", amountCents: parts.netCents }],
    });
    expect(document.totalCents).toBe(split.grossCents);
  });

  it("elige el precio vigente a esa hora y cierra la diferencia del turno", () => {
    const cents = priceAt(
      [
        { validFrom: "2026-10-01T00:00:00.000Z", cents: 100_000 },
        { validFrom: "2026-10-18T12:00:00.000Z", cents: 120_000 },
      ],
      "2026-10-19T08:00:00.000Z",
    );
    expect(cents).toBe(120_000);
    expect(priceAt([{ validFrom: "2026-10-20T00:00:00.000Z", cents: 1 }], "2026-10-19T00:00:00.000Z")).toBeNull();
    expect(shiftGap({ fuelCents: 100_000, shopCents: 5_000, collectedCents: 104_000, invoicedCents: 90_000 })).toEqual({
      soldCents: 105_000,
      collectedDifference: 1_000,
      invoiceDifference: 15_000,
    });
    expect(shiftBoard({ fuelCents: 100_000, shopCents: 0, collectedCents: 0, invoicedCents: 0, paymentsEntered: false }).collectedDifference).toBeNull();
    expect(fuelShown(50, 80, false)).toBe(80);
    expect(fuelShown(50, 80, true)).toBe(50);
    expect(withinCapacity(20_000, 20_000)).toBe(true);
    expect(withinCapacity(20_000, 26_500)).toBe(false);
  });

  it("un cambio de aforador abre el turno siguiente en la lectura nueva", () => {
    expect(openingAfterReset(1500.2, "2026-10-19T10:00:00.000Z", [])).toBe(1500.2);
    expect(openingAfterReset(1500.2, "2026-10-19T10:00:00.000Z", [{ at: "2026-10-19T12:00:00.000Z", reading: 10 }])).toBe(10);
    expect(openingAfterReset(1500.2, "2026-10-19T15:00:00.000Z", [{ at: "2026-10-19T12:00:00.000Z", reading: 10 }])).toBe(1500.2);
    expect(openingAfterReset(null, null, [])).toBe(0);
  });
});