import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPRAS_ALICUOTAS, COMPRAS_CBTE, IMPORTACION_BIENES_ALICUOTA, VENTAS_ALICUOTAS, VENTAS_CBTE, codigoOperacion, formatFixed, makeTxt, normalizarMoneda, toAnsi } from ".";
import { makeZip } from "./zip";
import { buildLibroIvaDigital } from "./build";

// Golden files armados campo por campo según el Anexo I de ARCA (RG 4597).
const z = (n: number, w: number) => String(n).padStart(w, "0");
const a = (s: string, w: number) => s.padEnd(w, " ");
const imp = (cents: number) => (cents < 0 ? `-${String(-cents).padStart(14, "0")}` : String(cents).padStart(15, "0"));

const venta = { fecha: "2026-09-05", tipoCbte: 1, puntoVenta: 3, numeroDesde: 10, numeroHasta: 10, docTipo: 80, docNro: "30-71000003-0", denominacion: "PRUEBA SA", totalCents: 1_215_000, noGravadoCents: 0, exentoCents: 5_000, percepIibbCents: 0, moneda: "$", tipoCambio: 1, cantidadAlicuotas: 1, codigoOperacion: "0", otrosTributosCents: 0 };
const compra = { ...venta, docNro: "20123456786", denominacion: "PROVEEDOR ÑANDÚ SRL", percepIvaCents: 30_000, percepIibbCents: 12_345, creditoFiscalCents: 210_000, moneda: "PES" };

describe("Libro IVA Digital — golden RG 4597", () => {
  it("VENTAS_CBTE (266)", () => {
    const expected = [
      "20260905", z(1, 3), z(3, 5), z(10, 20), z(10, 20), z(80, 2), z(30710000030, 20), a("PRUEBA SA", 30),
      imp(1_215_000), imp(0), imp(0), imp(5_000), imp(0), imp(0), imp(0), imp(0),
      "PES", "0001000000", "1", "0", imp(0), "00000000",
    ].join("");
    expect(expected).toHaveLength(266);
    expect(formatFixed(venta, VENTAS_CBTE)).toBe(expected);
  });
  it("VENTAS_ALICUOTAS (62)", () => {
    const expected = [z(1, 3), z(3, 5), z(10, 20), imp(1_000_000), z(5, 4), imp(210_000)].join("");
    expect(expected).toHaveLength(62);
    expect(formatFixed({ tipoCbte: 1, puntoVenta: 3, numero: 10, netoCents: 1_000_000, codigo: 5, ivaCents: 210_000 }, VENTAS_ALICUOTAS)).toBe(expected);
  });
  it("COMPRAS_CBTE (325)", () => {
    const expected = [
      "20260905", z(1, 3), z(3, 5), z(10, 20), a("", 16), z(80, 2), z(20123456786, 20), a("PROVEEDOR ÑANDÚ SRL", 30),
      imp(1_215_000), imp(0), imp(5_000), imp(30_000), imp(0), imp(12_345), imp(0), imp(0),
      "PES", "0001000000", "1", "0", imp(210_000), imp(0), z(0, 11), a("", 30), imp(0),
    ].join("");
    expect(expected).toHaveLength(325);
    expect(formatFixed(compra, COMPRAS_CBTE)).toBe(expected);
  });
  it("COMPRAS_ALICUOTAS (84)", () => {
    const expected = [z(1, 3), z(3, 5), z(10, 20), z(80, 2), z(20123456786, 20), imp(1_000_000), z(5, 4), imp(210_000)].join("");
    expect(expected).toHaveLength(84);
    expect(formatFixed({ tipoCbte: 1, puntoVenta: 3, numero: 10, docTipo: 80, docNro: "20-12345678-6", netoCents: 1_000_000, codigo: 5, ivaCents: 210_000 }, COMPRAS_ALICUOTAS)).toBe(expected);
  });
  it("IMPORTACION_BIENES_ALICUOTA (50) y cabecera con despacho", () => {
    const expected = [a("26001IC04123456A", 16), imp(500_000), z(5, 4), imp(105_000)].join("");
    expect(expected).toHaveLength(50);
    expect(formatFixed({ tipoCbte: 66, puntoVenta: 0, numero: 0, despacho: "26001IC04123456A", netoCents: 500_000, codigo: 5, ivaCents: 105_000 }, IMPORTACION_BIENES_ALICUOTA)).toBe(expected);
    const head = formatFixed({ ...compra, tipoCbte: 66, puntoVenta: 0, numeroDesde: 0, despacho: "26001IC04123456A" }, COMPRAS_CBTE);
    expect(head.slice(36, 52)).toBe("26001IC04123456A");
    expect(head.slice(16, 36)).toBe(z(0, 20));
  });
  it("importe negativo: '-' en la primera posición", () => {
    expect(formatFixed({ ...compra, totalCents: -1_210_000 }, COMPRAS_CBTE).slice(104, 119)).toBe("-00000001210000");
  });
  it("moneda y código de operación", () => {
    expect(["$", "", null, "ARS", "PES"].map(normalizarMoneda)).toEqual(["PES", "PES", "PES", "PES", "PES"]);
    expect(normalizarMoneda("USD")).toBe("DOL");
    expect(codigoOperacion({ alicuotas: [{ codigo: 5, ivaCents: 1 }], exentoCents: 0, noGravadoCents: 0 })).toBe("0");
    expect(codigoOperacion({ alicuotas: [{ codigo: 3, ivaCents: 0 }], exentoCents: 100, noGravadoCents: 0 })).toBe("E");
  });
  it("CRLF, ANSI y ZIP legible", () => {
    const txt = makeTxt([venta, venta], VENTAS_CBTE);
    expect(txt.split("\r\n")).toHaveLength(3);
    const ansi = toAnsi(formatFixed(compra, COMPRAS_CBTE));
    expect(ansi).toHaveLength(325);
    const dir = mkdtempSync(join(tmpdir(), "liva-"));
    writeFileSync(join(dir, "x.zip"), makeZip([{ name: "A.txt", data: toAnsi(txt) }, { name: "B.txt", data: Buffer.from("") }]));
    const list = execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),[len(z.read(n)) for n in z.namelist()])", join(dir, "x.zip")]).toString().trim();
    expect(list).toBe(`None [${txt.length}, 0]`);
  });
  it("convierte DOL a pesos y conserva moneda y tipo de cambio", () => {
    const built = buildLibroIvaDigital([{
      id: "dol", libro: "compras", fecha_cbte: "2026-09-05", tipo_cbte: 1, punto_venta: 3,
      numero_desde: "10", numero_hasta: "10", doc_tipo: 80, doc_nro: "20123456786",
      denominacion: "PROVEEDOR", total_cents: 121_000, moneda: "DOL", tipo_cambio: 1050.5,
      credito_fiscal_computable_cents: 21_000,
    }], [{ comprobante_id: "dol", alicuota_codigo: 5, neto_cents: 100_000, iva_cents: 21_000 }]);
    const head = built.files.LIBRO_IVA_DIGITAL_COMPRAS_CBTE;
    const rate = built.files.LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS;
    expect(head.slice(104, 119)).toBe(imp(127_110_500));
    expect(head.slice(224, 227)).toBe("DOL");
    expect(head.slice(227, 237)).toBe("1050500000");
    expect(rate.slice(50, 65)).toBe(imp(105_050_000));
    expect(rate.slice(69, 84)).toBe(imp(22_060_500));
  });
});
