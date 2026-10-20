import { describe, expect, it } from "vitest";
import { cajaDifferenceText, conceptoError, countNoun, fiscalNumber, formatMeasure, formatMoney, formatNumber, formatQty, parseDbNumber, parseLocaleNumber, parseMoneyToCents, paymentLabel, preferredCashAccountId, signedMoney, todayIso } from "./format";
import { blocksNegativeStock, cashDirectionForParty, chainStockDelta, creditExceeds, creditNoteGate, derivedStockFactor, documentFlow, documentStatusLabel, invoiceBlocked, isBelowMinimum, negativeStockDecision } from "./stock-rules";

describe("fecha y unidades", () => {
  it("usa el día de Argentina aunque en UTC ya sea el día siguiente", () => {
    expect(todayIso(new Date("2026-10-20T02:30:00.000Z"))).toBe("2026-10-19");
    expect(todayIso(new Date("2026-10-20T15:00:00.000Z"))).toBe("2026-10-20");
  });

  it("pluraliza litros y no deja ceros de más en el m3", () => {
    expect(formatMeasure(1, "litro")).toBe("1 litro");
    expect(formatMeasure(120.5, "litro")).toBe("120,5 litros");
    expect(formatMeasure(8000, "m3")).toBe("8.000 m³");
  });

  it("lee coma decimal y miles con punto", () => {
    expect(parseLocaleNumber("10534,8")).toBe(10534.8);
    expect(parseLocaleNumber("2500,50")).toBe(2500.5);
    expect(parseLocaleNumber("1.234,56")).toBe(1234.56);
    expect(parseLocaleNumber("10.5")).toBe(10.5);
    expect(parseLocaleNumber("1.234")).toBe(1234);
    expect(parseMoneyToCents("1.234,56")).toBe(123_456);
    expect(parseMoneyToCents("")).toBeNull();
    expect(paymentLabel("cuenta_corriente")).toBe("Cuenta corriente");
    expect(formatQty(120340)).toBe("120.340");
    expect(formatNumber(7, 4321)).toBe("0007-00004321");
    expect(fiscalNumber({ kind: "compra", pointOfSale: 4, number: 15, supplierPos: 7, supplierNumber: 4321 })).toBe("0007-00004321");
    expect(fiscalNumber({ kind: "venta", pointOfSale: 4, number: 15, supplierPos: 7, supplierNumber: 4321 })).toBe("0004-00000015");
    expect(cajaDifferenceText(20_000_00, 0)).toBe(`Diferencia ${formatMoney(-20_000_00)} (faltante)`);
    expect(cajaDifferenceText(0, 150_00)).toBe(`Diferencia ${signedMoney(150_00)} (sobrante)`);
    expect(signedMoney(150_00).startsWith("+")).toBe(true);
    expect(creditNoteGate(true, true, false)).toBe("exceso");
    expect(creditNoteGate(false, true, false)).toBe("preguntar");
    expect(creditNoteGate(false, true, true)).toBe("emitir");
    expect(formatMoney(-20_000_00).startsWith("-")).toBe(true);
    const caja = { id: "caja", kind: "caja" };
    const banco = { id: "banco", kind: "banco" };
    expect(preferredCashAccountId([banco, caja], null)).toBe("caja");
    expect(preferredCashAccountId([banco], null)).toBe("");
    expect(preferredCashAccountId([banco, caja], "banco")).toBe("caja");
    expect(conceptoError("ab")).toBe("Escribí un concepto (mínimo 3 letras)");
    expect(conceptoError("Peaje")).toBeNull();
    expect(countNoun(1, "comprobante", "comprobantes")).toBe("1 comprobante");
    expect(countNoun(2, "comprobante", "comprobantes")).toBe("2 comprobantes");
    expect(parseDbNumber("5.000")).toBe(5);
    expect(parseLocaleNumber("5.000")).toBe(5000);
    expect(negativeStockDecision(true, true, true).block).toBe(false);
    expect(negativeStockDecision(true, true, false).error).toMatch(/negativo/);
    expect(derivedStockFactor("remito", "venta", -1)).toBe(0);
    expect(derivedStockFactor("pedido", "remito", -1)).toBe(-1);
    expect(blocksNegativeStock(2, true, false)).toBe(false);
    expect(blocksNegativeStock(-2, true, false)).toBe(true);
    expect(blocksNegativeStock(-2, true, true)).toBe(false);
    expect(documentFlow([])).toBe("pendiente");
    expect(documentFlow(["remito"])).toBe("remitido");
    expect(documentStatusLabel({ kind: "venta", status: "confirmado" }, "pendiente")).toBe("Confirmado");
    expect(documentStatusLabel({ kind: "remito", status: "confirmado" }, "pendiente")).toBe("Confirmado");
    expect(documentStatusLabel({ kind: "pedido", status: "confirmado" }, "pendiente")).toBe("Pendiente");
    expect(documentStatusLabel({ kind: "pedido", status: "anulado" }, "facturado")).toBe("Anulado");
    expect(invoiceBlocked("pedido", ["remito"])).toMatch(/remito/);
    expect(invoiceBlocked("remito", ["venta"])).toMatch(/facturado/);
    expect(invoiceBlocked("pedido", [])).toBeNull();
    expect(creditExceeds(1000, 400, 700)).toBe(true);
    expect(creditExceeds(1000, 400, 600)).toBe(false);
    expect(documentFlow(["remito", "venta"])).toBe("facturado");
  });

  it("pedido, remito y factura descuentan el stock una sola vez", () => {
    expect(chainStockDelta(0, -1, -1)).toBe(-1);
    expect(derivedStockFactor("pedido", "venta", -1)).toBe(-1);
    expect(documentFlow(["remito", "venta"])).toBe("facturado");
  });

  it("el mínimo en cero no es falta de stock y el pago a proveedor sale de caja", () => {
    expect(isBelowMinimum(0, 0)).toBe(false);
    expect(isBelowMinimum(3, 5)).toBe(true);
    expect(isBelowMinimum(5, 5)).toBe(false);
    expect(cashDirectionForParty("customer")).toBe("in");
    expect(cashDirectionForParty("supplier")).toBe("out");
  });
});