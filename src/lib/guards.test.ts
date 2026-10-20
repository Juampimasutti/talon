import { describe, expect, it } from "vitest";
import { cashOutAllowed, collectionAllowed, constraintMessage, kmAllowed, moneyError, plateError } from "./guards";
import { balancePhrase, formatDateTime, formatMeasure, formatMoney } from "./format";

describe("controles de carga", () => {
  it("rechaza importes vacíos o enormes y la caja en negativo", () => {
    expect(moneyError(0)).toMatch(/mayor a cero/);
    expect(moneyError(150)).toBeNull();
    expect(cashOutAllowed(1000, 1500, false)).toMatch(/negativo/);
    expect(cashOutAllowed(1000, 1500, true)).toBeNull();
  });

  it("el cobro no puede pasar el saldo salvo que sea anticipo", () => {
    expect(collectionAllowed(5000, 8000, false)).toMatch(/anticipo/);
    expect(collectionAllowed(5000, 8000, true)).toBeNull();
  });

  it("la patente inválida dice el formato", () => {
    expect(plateError("123")).toMatch(/ABC123/);
    expect(plateError("ab 123 cd")).toBeNull();
    expect(plateError("AE123BC")).toBeNull();
  });

  it("el cierre del camión no puede bajar el kilometraje", () => {
    expect(kmAllowed(120340, 120300)).toMatch(/menor/);
    expect(kmAllowed(120340, 120400)).toBeNull();
    expect(kmAllowed(null, 10)).toBeNull();
  });

  it("traduce el código duplicado y muestra la hora de Argentina", () => {
    expect(constraintMessage("23505", 'duplicate key "document_types_company_id_code_key"')).toBe("Ya existe un comprobante con ese código");
    expect(constraintMessage("23505", 'duplicate key value violates unique constraint "ledger_accounts_company_id_code_key"')).toBe("Ya existe una cuenta con ese código");
    expect(constraintMessage("23505", "products_company_id_sku_key")).toBe("Ya existe un artículo con ese código");
    expect(constraintMessage("23505", "fuel_trucks_company_id_plate_key")).toBe("Ya hay un camión con esa patente");
    expect(constraintMessage("23505", "fuel_pumps_company_number_uidx")).toBe("Ya hay un surtidor con ese número");
    expect(formatDateTime("2026-10-20T03:30:00.000Z")).toContain("20");
    expect(formatDateTime("2026-10-20T02:30:00.000Z")).toMatch(/19/);
    expect(formatMeasure(1, "m3")).toBe("1 m³");
    expect(formatMeasure(2, "litro")).toBe("2 litros");
    expect(balancePhrase("proveedor", -430_000)).toBe(`Saldo a favor nuestro ${formatMoney(430_000)}`);
    expect(balancePhrase("cliente", -100)).toMatch(/Saldo a favor del cliente/);
    expect(balancePhrase("cliente", 100)).toMatch(/Nos debe/);
  });
});
