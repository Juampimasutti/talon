import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseMisComprobantesXlsx } from "./mis-comprobantes";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name));
const cuit = "20111111112";

describe("Mis Comprobantes", () => {
  it("parsea los dos fixtures, aplica signos y acepta B/C recibidos sin crédito", () => {
    const emitted = parseMisComprobantesXlsx(fixture("mis-comprobantes-emitidos-ejemplo.xlsx"), { companyCuit: cuit });
    const received = parseMisComprobantesXlsx(fixture("mis-comprobantes-recibidos-ejemplo.xlsx"), { companyCuit: cuit });
    expect(emitted.tipo).toBe("emitidos");
    expect(received.tipo).toBe("recibidos");
    expect([...emitted.rows, ...received.rows].filter((r) => r.estado === "rechazado")).toHaveLength(0);
    expect(emitted.rows.find((r) => r.tipoCbte === 3)?.signo).toBe(-1);
    expect(received.rows.find((r) => r.tipoCbte === 11)?.creditoFiscalComputableCents).toBe(0);
    expect(emitted.rows.find((r) => r.tipoCbte === 6 && r.docNro === "0")?.docTipo).toBe(99);
    expect(received.rows.some((r) => r.avisos.some((a) => a.includes("Residuo")))).toBe(true);
  });

  it("rechaza el archivo entero si el CUIT no coincide", () => {
    expect(() => parseMisComprobantesXlsx(fixture("mis-comprobantes-emitidos-ejemplo.xlsx"), { companyCuit: "30710000014" }))
      .toThrow("no coincide");
  });

  it("al reimportar marca todas las filas como duplicadas", () => {
    const first = parseMisComprobantesXlsx(fixture("mis-comprobantes-emitidos-ejemplo.xlsx"), { companyCuit: cuit });
    const second = parseMisComprobantesXlsx(fixture("mis-comprobantes-emitidos-ejemplo.xlsx"), {
      companyCuit: cuit, existingIdentities: first.rows.map((r) => r.identidad),
    });
    expect(second.resumen).toEqual({ ok: 0, duplicados: first.rows.length, rechazados: 0 });
  });

  it.each([[0.04, "ok"], [0.06, "rechazado"]] as const)("aplica tolerancia a una diferencia de $%s", (difference, expected) => {
    const workbook = XLSX.read(fixture("mis-comprobantes-emitidos-ejemplo.xlsx"), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const totalIndex = (matrix[1] as string[]).indexOf("Imp. Total");
    matrix[3][totalIndex] = Number(matrix[3][totalIndex]) + difference;
    workbook.Sheets[workbook.SheetNames[0]] = XLSX.utils.aoa_to_sheet(matrix);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const parsed = parseMisComprobantesXlsx(buffer, { companyCuit: cuit });
    expect(parsed.rows[1].estado).toBe(expected);
  });
});
