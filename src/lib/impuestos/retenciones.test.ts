import { describe,expect,it } from "vitest";import { sumarMeses,validarPeriodoComputo } from "./retenciones";
describe("cómputo de retenciones y percepciones",()=>{
 it("cruza diciembre y respeta los cinco períodos",()=>{expect(sumarMeses("202612",1)).toBe("202701");expect(validarPeriodoComputo("percepcion","202612","202705")).toBeNull();expect(validarPeriodoComputo("percepcion","202612","202706")).toContain("cinco");});
 it("retención sólo en origen",()=>{expect(validarPeriodoComputo("retencion","202609","202609")).toBeNull();expect(validarPeriodoComputo("retencion","202609","202610")).toContain("origen");});
});
