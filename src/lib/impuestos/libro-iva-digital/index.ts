/**
 * Libro IVA Digital (RG 4597) — diseños de registro tomados del PDF oficial de ARCA
 * "Anexo I – Diseños de registros" (https://www.arca.gob.ar/iva/documentos/,
 * copia en erp/arca-tablas/raw/libro-iva-digital-diseno-registros.pdf).
 *
 * Reglas generales del instructivo: importes de 15 posiciones (13 enteros + 2 decimales
 * sin punto, el "-" va en la primera posición); campos numéricos con ceros a la
 * izquierda; alfanuméricos con blancos a la derecha; archivos ANSI (Windows-1252);
 * los archivos de alícuotas respetan el mismo orden que los de comprobantes; en
 * compras B/C la cantidad de alícuotas es 0.
 * No se incluyen los diseños TurIVA (campo 23 de ventas / 26 de compras).
 */
export type FixedField<T> = {
  n: number;
  desde: number;
  hasta: number;
  /** N = numérico (ceros a la izquierda); A = alfabético/alfanumérico (blancos a la derecha); Z = alfanumérico con ceros a la izquierda. */
  tipo: "N" | "A" | "Z";
  nombre: string;
  value: (row: T) => string | number | bigint | null | undefined;
};

export type LibroRow = {
  fecha: string; tipoCbte: number; puntoVenta: number; numeroDesde: string | number; numeroHasta: string | number;
  despacho?: string | null;
  docTipo: number; docNro: string; denominacion: string; totalCents: number;
  noGravadoCents?: number; exentoCents?: number; percepNoCategCents?: number;
  percepIvaCents?: number; percepOtrosNacCents?: number; percepIibbCents?: number; percepMuniCents?: number;
  internosCents?: number; otrosTributosCents?: number;
  moneda?: string; tipoCambio?: number;
  cantidadAlicuotas?: number; codigoOperacion?: string; creditoFiscalCents?: number;
};
export type AlicuotaRow = { tipoCbte: number; puntoVenta: number; numero: string | number; docTipo?: number; docNro?: string; despacho?: string | null; netoCents: number; codigo: number; ivaCents: number };

const field = <T>(n: number, desde: number, hasta: number, tipo: FixedField<T>["tipo"], nombre: string, value: FixedField<T>["value"]): FixedField<T> => ({ n, desde, hasta, tipo, nombre, value });
const fecha = (r: { fecha: string }) => r.fecha.slice(0, 10).replaceAll("-", "");
const digits = (value: string | undefined | null) => String(value ?? "").replace(/\D/g, "");
const tipoCambio = (r: LibroRow) => Math.round((r.tipoCambio ?? 1) * 1_000_000);
const moneda = (r: LibroRow) => normalizarMoneda(r.moneda);
const amt = (value: number | undefined) => Math.round(value ?? 0);

/** Código de moneda de ARCA: "$", "ARS" y vacío son pesos (PES). */
export function normalizarMoneda(value: string | null | undefined) {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v || v === "$" || v === "ARS" || v === "PESOS") return "PES";
  if (v === "USD" || v === "U$S" || v === "US$" || v === "U$D") return "DOL";
  return v.slice(0, 3);
}

// LIBRO_IVA_DIGITAL_VENTAS_CBTE — longitud 266
export const VENTAS_CBTE: FixedField<LibroRow>[] = [
  field(1, 1, 8, "N", "Fecha de comprobante", fecha),
  field(2, 9, 11, "N", "Tipo de comprobante", (r) => r.tipoCbte),
  field(3, 12, 16, "N", "Punto de venta", (r) => r.puntoVenta),
  field(4, 17, 36, "N", "Número de comprobante", (r) => r.numeroDesde),
  field(5, 37, 56, "N", "Número de comprobante hasta", (r) => r.numeroHasta),
  field(6, 57, 58, "N", "Código de documento del comprador", (r) => r.docTipo),
  field(7, 59, 78, "Z", "Número de identificación del comprador", (r) => digits(r.docNro)),
  field(8, 79, 108, "A", "Apellido y nombre o denominación del comprador", (r) => r.denominacion),
  field(9, 109, 123, "N", "Importe total de la operación", (r) => amt(r.totalCents)),
  field(10, 124, 138, "N", "Conceptos que no integran el precio neto gravado", (r) => amt(r.noGravadoCents)),
  field(11, 139, 153, "N", "Percepción a no categorizados", (r) => amt(r.percepNoCategCents)),
  field(12, 154, 168, "N", "Operaciones exentas", (r) => amt(r.exentoCents)),
  field(13, 169, 183, "N", "Percepciones o pagos a cuenta de impuestos nacionales", (r) => amt(r.percepIvaCents) + amt(r.percepOtrosNacCents)),
  field(14, 184, 198, "N", "Percepciones de Ingresos Brutos", (r) => amt(r.percepIibbCents)),
  field(15, 199, 213, "N", "Percepciones municipales", (r) => amt(r.percepMuniCents)),
  field(16, 214, 228, "N", "Impuestos internos", (r) => amt(r.internosCents)),
  field(17, 229, 231, "A", "Código de moneda", moneda),
  field(18, 232, 241, "N", "Tipo de cambio", tipoCambio),
  field(19, 242, 242, "N", "Cantidad de alícuotas de IVA", (r) => r.cantidadAlicuotas ?? 0),
  field(20, 243, 243, "A", "Código de operación", (r) => r.codigoOperacion ?? "0"),
  field(21, 244, 258, "N", "Otros tributos", (r) => amt(r.otrosTributosCents)),
  field(22, 259, 266, "N", "Fecha de vencimiento de pago", () => 0),
];

// LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS — longitud 62
export const VENTAS_ALICUOTAS: FixedField<AlicuotaRow>[] = [
  field(1, 1, 3, "N", "Tipo de comprobante", (r) => r.tipoCbte),
  field(2, 4, 8, "N", "Punto de venta", (r) => r.puntoVenta),
  field(3, 9, 28, "N", "Número de comprobante", (r) => r.numero),
  field(4, 29, 43, "N", "Importe neto gravado", (r) => amt(r.netoCents)),
  field(5, 44, 47, "N", "Alícuota de IVA", (r) => r.codigo),
  field(6, 48, 62, "N", "Impuesto liquidado", (r) => amt(r.ivaCents)),
];

// LIBRO_IVA_DIGITAL_COMPRAS_CBTE — longitud 325 (también es la cabecera de importación de bienes)
export const COMPRAS_CBTE: FixedField<LibroRow>[] = [
  field(1, 1, 8, "N", "Fecha de comprobante o de oficialización", fecha),
  field(2, 9, 11, "N", "Tipo de comprobante", (r) => r.tipoCbte),
  field(3, 12, 16, "N", "Punto de venta", (r) => r.puntoVenta),
  field(4, 17, 36, "N", "Número de comprobante", (r) => r.numeroDesde),
  field(5, 37, 52, "A", "Despacho de importación", (r) => r.despacho ?? ""),
  field(6, 53, 54, "N", "Código de documento del vendedor", (r) => r.docTipo),
  field(7, 55, 74, "Z", "Número de identificación del vendedor", (r) => digits(r.docNro)),
  field(8, 75, 104, "A", "Apellido y nombre o denominación del vendedor", (r) => r.denominacion),
  field(9, 105, 119, "N", "Importe total de la operación", (r) => amt(r.totalCents)),
  field(10, 120, 134, "N", "Conceptos que no integran el precio neto gravado", (r) => amt(r.noGravadoCents)),
  field(11, 135, 149, "N", "Operaciones exentas", (r) => amt(r.exentoCents)),
  field(12, 150, 164, "N", "Percepciones o pagos a cuenta de IVA", (r) => amt(r.percepIvaCents)),
  field(13, 165, 179, "N", "Percepciones o pagos a cuenta de otros impuestos nacionales", (r) => amt(r.percepOtrosNacCents)),
  field(14, 180, 194, "N", "Percepciones de Ingresos Brutos", (r) => amt(r.percepIibbCents)),
  field(15, 195, 209, "N", "Percepciones de impuestos municipales", (r) => amt(r.percepMuniCents)),
  field(16, 210, 224, "N", "Impuestos internos", (r) => amt(r.internosCents)),
  field(17, 225, 227, "A", "Código de moneda", moneda),
  field(18, 228, 237, "N", "Tipo de cambio", tipoCambio),
  field(19, 238, 238, "N", "Cantidad de alícuotas de IVA", (r) => r.cantidadAlicuotas ?? 0),
  field(20, 239, 239, "A", "Código de operación", (r) => r.codigoOperacion ?? "0"),
  field(21, 240, 254, "N", "Crédito fiscal computable", (r) => amt(r.creditoFiscalCents)),
  field(22, 255, 269, "N", "Otros tributos", (r) => amt(r.otrosTributosCents)),
  field(23, 270, 280, "N", "CUIT emisor/corredor", () => 0),
  field(24, 281, 310, "A", "Denominación del emisor/corredor", () => ""),
  field(25, 311, 325, "N", "IVA comisión", () => 0),
];

// LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS — longitud 84
export const COMPRAS_ALICUOTAS: FixedField<AlicuotaRow>[] = [
  field(1, 1, 3, "N", "Tipo de comprobante", (r) => r.tipoCbte),
  field(2, 4, 8, "N", "Punto de venta", (r) => r.puntoVenta),
  field(3, 9, 28, "N", "Número de comprobante", (r) => r.numero),
  field(4, 29, 30, "N", "Código de documento del vendedor", (r) => r.docTipo ?? 80),
  field(5, 31, 50, "Z", "Número de identificación del vendedor", (r) => digits(r.docNro)),
  field(6, 51, 65, "N", "Importe neto gravado", (r) => amt(r.netoCents)),
  field(7, 66, 69, "N", "Alícuota de IVA", (r) => r.codigo),
  field(8, 70, 84, "N", "Impuesto liquidado", (r) => amt(r.ivaCents)),
];

// LIBRO_IVA_DIGITAL_IMPORTACION_BIENES_ALICUOTA — longitud 50
export const IMPORTACION_BIENES_ALICUOTA: FixedField<AlicuotaRow>[] = [
  field(1, 1, 16, "A", "Despacho de importación", (r) => r.despacho ?? ""),
  field(2, 17, 31, "N", "Importe neto gravado", (r) => amt(r.netoCents)),
  field(3, 32, 35, "N", "Alícuota de IVA", (r) => r.codigo),
  field(4, 36, 50, "N", "Impuesto liquidado", (r) => amt(r.ivaCents)),
];

/** Lleva el texto a caracteres representables en Windows-1252 (sin saltos de línea). */
function ansiText(value: string) {
  return value.replace(/[\r\n\t]/g, " ").replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?"));
}

export function formatFixed<T>(row: T, fields: FixedField<T>[]) {
  const length = fields.at(-1)?.hasta ?? 0;
  let line = "";
  for (const spec of fields) {
    if (spec.desde !== line.length + 1) throw new Error(`Diseño discontinuo en ${spec.nombre}`);
    const width = spec.hasta - spec.desde + 1;
    let value = String(spec.value(row) ?? "");
    if (spec.tipo === "A") {
      value = ansiText(value).slice(0, width).padEnd(width, " ");
    } else {
      if (spec.tipo === "N" && !/^-?\d*$/.test(value)) throw new Error(`${spec.nombre} debe ser numérico`);
      const negative = value.startsWith("-");
      const body = negative ? value.slice(1) : value;
      if (body.length > width - (negative ? 1 : 0)) throw new Error(`${spec.nombre} excede ${width} posiciones`);
      value = negative ? `-${body.padStart(width - 1, "0")}` : body.padStart(width, "0");
    }
    line += value;
  }
  if (line.length !== length) throw new Error(`Línea inválida: ${line.length}; se esperaban ${length}`);
  return line;
}

export function makeTxt<T>(rows: T[], fields: FixedField<T>[]) {
  const lines = rows.map((row) => formatFixed(row, fields));
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
}

/** Codifica en Windows-1252/ISO-8859-1 como pide ARCA. */
export function toAnsi(text: string) {
  return Buffer.from(text, "latin1");
}

const DISCRIMINA = new Set([1, 2, 3, 4, 5, 51, 52, 53, 54, 63, 66, 67, 81, 112, 113, 114, 118, 119, 120, 201, 202, 203]);
/** Comprobantes que discriminan IVA (A, M, despachos, etc.). B y C no. */
export function discriminaIva(tipoCbte: number) { return DISCRIMINA.has(tipoCbte); }

/** Código de operación (campo 20): sólo cuando no hay IVA (alícuota 0 / sin alícuotas). */
export function codigoOperacion(input: { alicuotas: { codigo: number; ivaCents: number }[]; exentoCents: number; noGravadoCents: number; importacion?: boolean }) {
  const conIva = input.alicuotas.some((a) => a.codigo > 3 || a.ivaCents !== 0);
  if (conIva) return "0";
  if (input.importacion) return "X";
  if (input.exentoCents !== 0 || input.alicuotas.some((a) => a.codigo === 2)) return "E";
  if (input.noGravadoCents !== 0 || input.alicuotas.some((a) => a.codigo === 1)) return "N";
  return "0";
}
