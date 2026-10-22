import { describe, expect, it } from "vitest";
import { condicionDesdeComprobante, documentoTalon } from "./contraparte-talon";

describe("Crear también en Talón", () => {
  it("condición desde la letra", () => {
    expect(condicionDesdeComprobante({ libro: "ventas", letra: "A", docTipo: 80 }).taxCondition).toBe("ri");
    expect(condicionDesdeComprobante({ libro: "ventas", letra: "B", docTipo: 96 }).taxCondition).toBe("cf");
    expect(condicionDesdeComprobante({ libro: "ventas", letra: "B", docTipo: 80 })).toEqual({ taxCondition: "monotributo", revisar: true });
    expect(condicionDesdeComprobante({ libro: "compras", letra: "A", docTipo: 80 }).taxCondition).toBe("ri");
    expect(condicionDesdeComprobante({ libro: "compras", letra: "C", docTipo: 80 }).taxCondition).toBe("monotributo");
  });
  it("documento", () => {
    expect(documentoTalon(80, "30710000030")).toEqual({ docType: "CUIT", cuit: "30-71000003-0" });
    expect(documentoTalon(96, "12.345.678")).toEqual({ docType: "DNI", cuit: "12345678" });
    expect(documentoTalon(86, "20123456786").docType).toBe("OTRO");
  });
});
