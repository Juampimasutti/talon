import * as XLSX from "xlsx";
import { isValidCuit } from "@/lib/fiscal/cuit";

const RATE_COLUMNS = [
  { bps: 0, code: 3, net: "Neto Grav. IVA 0%", vat: null },
  { bps: 250, code: 9, net: "Neto Grav. IVA 2,5%", vat: "IVA 2,5%" },
  { bps: 500, code: 8, net: "Neto Grav. IVA 5%", vat: "IVA 5%" },
  { bps: 1050, code: 4, net: "Neto Grav. IVA 10,5%", vat: "IVA 10,5%" },
  { bps: 2100, code: 5, net: "Neto Grav. IVA 21%", vat: "IVA 21%" },
  { bps: 2700, code: 6, net: "Neto Grav. IVA 27%", vat: "IVA 27%" },
] as const;
const CREDIT_NOTES = new Set([3, 8, 13, 53, 203, 208, 213]);
const NON_DISCRIMINATING = new Set([6, 7, 8, 11, 12, 13]);
const REQUIRED = ["Fecha", "Tipo", "Punto de Venta", "Número Desde", "Imp. Total"];

export type ImportedRate = { codigo: number; bps: number; netoCents: number; ivaCents: number };
export type ImportedRow = {
  fila: number;
  estado: "ok" | "duplicado" | "rechazado";
  motivo?: string;
  avisos: string[];
  identidad: string;
  libro: "ventas" | "compras";
  fecha: string;
  periodo: string;
  tipoCbte: number;
  signo: 1 | -1;
  puntoVenta: number;
  numeroDesde: string;
  numeroHasta: string;
  cae: string;
  docTipo: number;
  docNro: string;
  denominacion: string;
  moneda: string;
  tipoCambio: number;
  alicuotas: ImportedRate[];
  netoNoGravadoCents: number;
  exentoCents: number;
  otrosTributosCents: number;
  totalIvaCents: number;
  totalCents: number;
  creditoFiscalComputableCents: number;
  raw: Record<string, unknown>;
};

export type ParseOptions = {
  companyCuit: string;
  toleranceCents?: number;
  existingIdentities?: Iterable<string>;
};

function normalized(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 0 });
  return String(value).trim();
}
function cents(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const number = typeof value === "number" ? value : Number(String(value).replaceAll(".", "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : Number.NaN;
}
function isoDate(value: unknown) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
function docCode(value: unknown) {
  const name = String(value ?? "").toUpperCase();
  if (!name) return 99;
  if (name.includes("CUIT")) return 80;
  if (name.includes("CUIL")) return 86;
  if (name.includes("DNI")) return 96;
  return 99;
}

export function parseMisComprobantesXlsx(input: Buffer | Uint8Array, options: ParseOptions) {
  const workbook = XLSX.read(input, { type: "buffer", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const title = String(matrix[0]?.[0] ?? "");
  const titleMatch = title.match(/Mis Comprobantes (Emitidos|Recibidos)\s*-\s*CUIT\s*(\d{11})/i);
  if (!titleMatch) throw new Error("No pude identificar el tipo de archivo ni el CUIT del titular");
  const tipo = titleMatch[1].toLowerCase() === "emitidos" ? "emitidos" : "recibidos";
  const titularCuit = titleMatch[2];
  if (titularCuit !== options.companyCuit.replace(/\D/g, "")) throw new Error("El CUIT del archivo no coincide con la empresa activa");
  const headers = (matrix[1] ?? []).map((v) => String(v ?? "").trim());
  for (const expected of REQUIRED) if (!headers.includes(expected)) throw new Error(`No encontré la columna ${expected}`);
  const index = new Map(headers.map((header, i) => [header, i]));
  const existing = new Set(options.existingIdentities ?? []);
  const seen = new Set<string>();
  const tolerance = options.toleranceCents ?? 5;
  const rows: ImportedRow[] = [];

  for (let ri = 2; ri < matrix.length; ri++) {
    const source = matrix[ri];
    if (!source || source.every((cell) => cell === null || cell === "")) continue;
    const get = (name: string) => source[index.get(name) ?? -1];
    const raw = Object.fromEntries(headers.map((h, i) => [h, source[i]]));
    const tipoCbte = Number(String(get("Tipo") ?? "").split("-")[0].trim());
    const fecha = isoDate(get("Fecha"));
    const puntoVenta = Number(get("Punto de Venta"));
    const numeroDesde = normalized(get("Número Desde"));
    const numeroHasta = normalized(get("Número Hasta")) || numeroDesde;
    const emitter = tipo === "emitidos" ? titularCuit : normalized(get("Nro. Doc. Emisor"));
    const identity = `${emitter}|${tipoCbte}|${puntoVenta}|${numeroDesde}`;
    const docLabel = tipo === "emitidos" ? get("Tipo Doc. Receptor") : get("Tipo Doc. Emisor");
    const docNro = tipo === "emitidos" ? normalized(get("Nro. Doc. Receptor")) : emitter;
    const denominacion = normalized(tipo === "emitidos" ? get("Denominación Receptor") : get("Denominación Emisor"));
    const sign = CREDIT_NOTES.has(tipoCbte) ? -1 : 1;
    const rates = RATE_COLUMNS.map((rate) => ({
      codigo: rate.code, bps: rate.bps, netoCents: cents(get(rate.net)), ivaCents: rate.vat ? cents(get(rate.vat)) : 0,
    })).filter((rate) => rate.netoCents !== 0 || rate.ivaCents !== 0);
    const netoNoGravadoCents = cents(get("Neto No Gravado"));
    const exentoCents = cents(get("Op. Exentas"));
    let otrosTributosCents = cents(get("Otros Tributos"));
    const totalIvaCents = cents(get("Total IVA"));
    const totalCents = cents(get("Imp. Total"));
    const componentTotal = rates.reduce((n, rate) => n + rate.netoCents + rate.ivaCents, 0)
      + netoNoGravadoCents + exentoCents + otrosTributosCents;
    const difference = totalCents - componentTotal;
    const avisos: string[] = [];
    let estado: ImportedRow["estado"] = "ok";
    let motivo: string | undefined;
    if (existing.has(identity) || seen.has(identity)) { estado = "duplicado"; motivo = "Comprobante ya importado"; }
    else if (!fecha || !Number.isInteger(tipoCbte) || !Number.isInteger(puntoVenta) || !numeroDesde) { estado = "rechazado"; motivo = "Datos obligatorios inválidos"; }
    else if (docCode(docLabel) === 80 && !isValidCuit(docNro)) { estado = "rechazado"; motivo = "CUIT de contraparte inválido"; }
    else if (!NON_DISCRIMINATING.has(tipoCbte) && Math.abs(difference) > tolerance) { estado = "rechazado"; motivo = `Los componentes difieren del total en ${Math.abs(difference)} centavos`; }
    else if (!NON_DISCRIMINATING.has(tipoCbte) && difference !== 0) {
      otrosTributosCents += difference;
      avisos.push(`Diferencia de ${difference} centavos ajustada en otros tributos`);
    }
    for (const rate of rates) {
      if (Math.abs(rate.netoCents) <= 5 && Math.abs(rate.ivaCents) <= 5) avisos.push(`Residuo de centavo en IVA ${rate.bps / 100}%`);
    }
    if ((tipo === "recibidos") && normalized(get("Nro. Doc. Receptor")) && normalized(get("Nro. Doc. Receptor")) !== titularCuit) {
      avisos.push("El receptor informado no coincide con el titular");
    }
    if (String(get("Moneda") ?? "$") !== "$" || Number(get("Tipo Cambio") ?? 1) !== 1) avisos.push("Moneda extranjera: revisar conversión a pesos");
    seen.add(identity);
    rows.push({
      fila: ri + 1, estado, motivo, avisos, identidad: identity, libro: tipo === "emitidos" ? "ventas" : "compras",
      fecha, periodo: fecha.slice(0, 7).replace("-", ""), tipoCbte, signo: sign, puntoVenta, numeroDesde, numeroHasta,
      cae: normalized(get("Cód. Autorización")), docTipo: docCode(docLabel), docNro: docNro || "0",
      denominacion: denominacion || "Consumidor final", moneda: normalized(get("Moneda")) || "$",
      tipoCambio: Number(get("Tipo Cambio") ?? 1), alicuotas: rates, netoNoGravadoCents, exentoCents,
      otrosTributosCents, totalIvaCents, totalCents, creditoFiscalComputableCents: tipo === "recibidos" && !NON_DISCRIMINATING.has(tipoCbte) ? totalIvaCents : 0, raw,
    });
  }
  return { tipo, titularCuit, rows, resumen: {
    ok: rows.filter((r) => r.estado === "ok").length,
    duplicados: rows.filter((r) => r.estado === "duplicado").length,
    rechazados: rows.filter((r) => r.estado === "rechazado").length,
  } };
}
