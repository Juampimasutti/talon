import { describe, expect, it } from "vitest";
import { exampleColumns, exampleRows } from "./fields";
import { autoMap, detectProfile } from "./fields";
import { readWorkbook, writeWorkbook } from "./excel";
import { parseDelimited, parseFixedWidth, toDelimited } from "./parse";
import { isValidCuit } from "../fiscal/cuit";
import { parseTaxCondition, reviewRow, suggestTaxCondition, totalsClose } from "./validate";

describe("archivos", () => {
  it("detecta punto y coma, coma y tab", () => {
    expect(parseDelimited("nombre;cuit\nAna;20-12345678-6").columns).toEqual(["nombre", "cuit"]);
    expect(parseDelimited("nombre,cuit\nAna,20-12345678-6").rows[0][1]).toBe("20-12345678-6");
    expect(parseDelimited("nombre\tcuit\nAna\t20-12345678-6").rows).toHaveLength(1);
  });

  it("respeta comillas y corta por ancho fijo", () => {
    const parsed = parseDelimited('nombre;nota\n"Kiosco; Sur";"dice ""hola"""');
    expect(parsed.rows[0]).toEqual(["Kiosco; Sur", 'dice "hola"']);
    const fixed = parseFixedWidth("20123456786Kiosco", [11, 6], false);
    expect(fixed.rows[0]).toEqual(["20123456786", "Kiosco"]);
  });

  it("mapea solo por el nombre de la columna", () => {
    const columns = ["Razón social", "CUIT", "Posición IVA", "Localidad"];
    const mapping = autoMap(columns, "clientes");
    expect(mapping["Razón social"]).toBe("nombre");
    expect(mapping.CUIT).toBe("cuit");
    expect(mapping["Posición IVA"]).toBe("condicion_iva");
    expect(mapping.Localidad).toBe("localidad");
  });

  it("reconoce el Excel de Mis Comprobantes", () => {
    const columns = ["Fecha de Emisión", "Tipo de Comprobante", "Punto de Venta", "Número Desde", "Denominación Receptor", "Nro. Doc. Receptor"];
    expect(detectProfile(columns)).toBe(null);
    expect(detectProfile(["Fecha de Emisión", "Tipo de Comprobante", "Punto de Venta", "Denominación Comprador"])).toBe("arca_emitidos");
    expect(detectProfile(["Tipo de Comprobante", "Punto de Venta", "Denominación Vendedor"])).toBe("arca_recibidos");
  });

  it("valida CUIT, IVA vacío y totales que no cierran", () => {
    const badCuit = reviewRow({
      entity: "clientes",
      columns: ["Nombre", "CUIT", "Condición IVA"],
      row: ["Ana", "20-12345678-9", "Responsable inscripto"],
      mapping: autoMap(["Nombre", "CUIT", "Condición IVA"], "clientes"),
      seen: new Set(),
      existing: new Set(),
    });
    expect(badCuit.errors.some((error) => error.includes("dígito"))).toBe(true);

    const missing = reviewRow({
      entity: "clientes",
      columns: ["Nombre", "CUIT"],
      row: ["Ana", "20-12345678-6"],
      mapping: autoMap(["Nombre", "CUIT"], "clientes"),
      seen: new Set(),
      existing: new Set(),
    });
    expect(missing.missingIva).toBe(true);
    expect(parseTaxCondition("mono")).toBe("monotributo");
    expect(parseTaxCondition("RI")).toBe("ri");
    expect(parseTaxCondition("CF")).toBe("cf");
    expect(parseTaxCondition("exento")).toBe("exento");
    const unknownIva = reviewRow({
      entity: "clientes",
      columns: ["Nombre", "Condición IVA"],
      row: ["Ana", "galaxia"],
      mapping: autoMap(["Nombre", "Condición IVA"], "clientes"),
      seen: new Set(),
      existing: new Set(),
    });
    expect(unknownIva.missingIva).toBe(true);
    expect(unknownIva.errors.some((error) => error.includes("no se entiende"))).toBe(true);
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(suggestTaxCondition("30712345671")).toBe("ri");
    expect(suggestTaxCondition("")).toBe("cf");

    const invoice = reviewRow({
      entity: "ventas",
      columns: exampleColumns("ventas"),
      row: ["2026-10-01", "FAC", "A", "4", "1", "20-12345678-6", "Ana", "100", "21", "0", "0", "0", "0", "100"],
      mapping: autoMap(exampleColumns("ventas"), "ventas"),
      seen: new Set(),
      existing: new Set(),
    });
    expect(invoice.errors.some((error) => error.includes("no cierra"))).toBe(true);
    expect(totalsClose(10000, 2100, 0, 0, 0, 0, 12100)).toBe(true);
  });

  it("vuelve a leer lo que exporta", () => {
    const columns = exampleColumns("clientes");
    const rows = exampleRows("clientes");
    const file = toDelimited(columns, rows, ";");
    const parsed = parseDelimited(file);
    const mapping = autoMap(parsed.columns, "clientes");
    const reviewed = reviewRow({
      entity: "clientes",
      columns: parsed.columns,
      row: parsed.rows[0],
      mapping,
      seen: new Set(),
      existing: new Set(),
    });
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.values.nombre).toBe("Kiosco del Parque");
    expect(reviewed.values.cuit).toBe("20-12345678-6");
    expect(reviewed.values.condicion_iva).toBe("ri");
  });

  it("un Excel se exporta y se vuelve a leer", async () => {
    const columns = exampleColumns("articulos");
    const rows = exampleRows("articulos");
    const buffer = await writeWorkbook([{ name: "articulos", columns, rows }]);
    const sheets = await readWorkbook(buffer);
    expect(sheets[0].columns).toEqual(columns);
    expect(sheets[0].rows[0][0]).toBe("YER-001");
    const mapping = autoMap(sheets[0].columns, "articulos");
    const reviewed = reviewRow({
      entity: "articulos",
      columns: sheets[0].columns,
      row: sheets[0].rows[0],
      mapping,
      seen: new Set(),
      existing: new Set(),
    });
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.values.sku).toBe("YER-001");
  });
});
