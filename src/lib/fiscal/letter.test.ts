import { describe, expect, it } from "vitest";
import { afipQrUrl } from "./arca";
import { documentLetter, priceModeForLetter, resolveLetter } from "./letter";

describe("letra de comprobante", () => {
  it("discrimina A, B y C según emisor y receptor", () => {
    expect(resolveLetter("ri", "ri")).toBe("A");
    expect(resolveLetter("ri", "monotributo")).toBe("B");
    expect(resolveLetter("ri", "cf")).toBe("B");
    expect(resolveLetter("ri", "exento")).toBe("B");
    expect(resolveLetter("monotributo", "ri")).toBe("C");
    expect(resolveLetter("monotributo", "cf")).toBe("C");
    expect(resolveLetter("exento", "ri")).toBe("C");
    expect(resolveLetter("cf", "ri")).toBe("C");
  });

  it("define si el precio se carga neto, final o sin IVA", () => {
    expect(priceModeForLetter("A", true)).toBe("net");
    expect(priceModeForLetter("B", true)).toBe("net");
    expect(priceModeForLetter("C", true)).toBe("sin_iva");
    expect(priceModeForLetter("A", false)).toBe("sin_iva");
    expect(priceModeForLetter(null, true)).toBe("sin_iva");
  });

  it("el pedido y el remito muestran la letra en vivo", () => {
    expect(documentLetter("pedido", false, "ri", "ri")).toBe("A");
    expect(documentLetter("remito", false, "ri", "cf")).toBe("B");
    expect(documentLetter("remito", false, "monotributo", "ri")).toBe("C");
    expect(documentLetter("venta", true, "ri", "ri")).toBe("A");
    expect(documentLetter("venta", false, "ri", "ri")).toBeNull();
  });

  it("arma el QR de AFIP solo si hay CAE", () => {
    expect(afipQrUrl({ cuit: "30-50999111-8", pointOfSale: 2, afipCode: 1, number: 15, issuedOn: "2026-10-20", totalCents: 121000, receiverCuit: "20-12345678-6", cae: null })).toBeNull();
    const url = afipQrUrl({ cuit: "30-50999111-8", pointOfSale: 2, afipCode: 1, number: 15, issuedOn: "2026-10-20", totalCents: 121000, receiverCuit: "20-12345678-6", cae: "71234567890123" });
    expect(url?.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
  });
});
