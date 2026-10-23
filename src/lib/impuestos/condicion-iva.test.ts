import { describe, expect, it } from "vitest";
import { condicionIvaSchema, puedeLiquidarF2002 } from "./condicion-iva";
describe("condición de IVA fiscal", () => {
  it("acepta sólo condiciones con equivalencia ARCA", () => {
    for (const value of ["ri","monotributo","exento","cf","no_alcanzado"]) expect(condicionIvaSchema.safeParse(value).success).toBe(true);
    expect(condicionIvaSchema.safeParse("cualquiera").success).toBe(false);
  });
  it("reserva F.2002 a responsables inscriptos", () => {
    expect(puedeLiquidarF2002("ri")).toBe(true);
    expect(puedeLiquidarF2002("monotributo")).toBe(false);
    expect(puedeLiquidarF2002("exento")).toBe(false);
  });
});
