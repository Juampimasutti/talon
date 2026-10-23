import { describe, expect, it } from "vitest";
import { avisoEsquema, esquemaParaPeriodo } from "./esquema";
describe("esquema de IVA por período", () => {
  it("selecciona el flujo según condición, período y configuración", () => {
    expect(esquemaParaPeriodo({}, "202510", "ri")).toBe("f2002_lid");
    expect(esquemaParaPeriodo({}, "202511", "ri")).toBe("iva_simple");
    expect(esquemaParaPeriodo({esquemaIva:"f2002_lid"}, "202601", "ri")).toBe("f2002_lid");
    expect(esquemaParaPeriodo({}, "202601", "exento")).toBe("lid_exento");
    expect(esquemaParaPeriodo({}, "202601", "monotributo")).toBe("no_corresponde");
    expect(avisoEsquema("202601","f2002_lid")).toContain("IVA Simple");
  });
});
