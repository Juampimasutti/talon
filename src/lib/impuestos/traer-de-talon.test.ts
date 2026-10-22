import { describe, expect, it } from "vitest";
import { documentoArca } from "./traer-de-talon";

describe("documento de la contraparte al traer de Talón", () => {
  it("normaliza CUIT con guiones, DNI y consumidor final", () => {
    expect(documentoArca("20-11111111-2")).toEqual({ docTipo: 80, docNro: "20111111112" });
    expect(documentoArca("12.345.678")).toEqual({ docTipo: 96, docNro: "12345678" });
    expect(documentoArca(null)).toEqual({ docTipo: 99, docNro: "0" });
    expect(documentoArca("0")).toEqual({ docTipo: 99, docNro: "0" });
  });
});
