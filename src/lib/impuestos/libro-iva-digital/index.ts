export type FixedField<T> = {
  n: number;
  desde: number;
  hasta: number;
  tipo: "N" | "A";
  nombre: string;
  value: (row: T) => string | number | bigint | null | undefined;
  decimales?: number;
};

export type LibroRow = {
  fecha: string; tipoCbte: number; puntoVenta: number; numeroDesde: string | number; numeroHasta: string | number;
  docTipo: number; docNro: string; denominacion: string; totalCents: number; moneda?: string; tipoCambio?: number;
  cantidadAlicuotas?: number; codigoOperacion?: string; creditoFiscalCents?: number;
};
export type AlicuotaRow = { tipoCbte: number; puntoVenta: number; numero: string | number; docNro?: string; netoCents: number; codigo: number; ivaCents: number };

const field = <T>(n: number, desde: number, hasta: number, tipo: "N" | "A", nombre: string, value: FixedField<T>["value"], decimales?: number): FixedField<T> => ({ n, desde, hasta, tipo, nombre, value, decimales });
const filler = <T>(n: number, desde: number, hasta: number) => field<T>(n, desde, hasta, "A", "Reservado", () => "");

// Las longitudes de Compras y sus alícuotas son las verificadas en el brief.
export const COMPRAS_CBTE: FixedField<LibroRow>[] = [
  field(1,1,8,"N","Fecha",r=>r.fecha.replaceAll("-","")), field(2,9,11,"N","Tipo",r=>r.tipoCbte),
  field(3,12,16,"N","Punto de venta",r=>r.puntoVenta), field(4,17,36,"N","Número",r=>r.numeroDesde),
  field(5,37,38,"N","Documento",r=>r.docTipo), field(6,39,58,"N","Número documento",r=>r.docNro),
  field(7,59,88,"A","Denominación",r=>r.denominacion), field(8,89,103,"N","Total",r=>r.totalCents),
  field(9,104,106,"A","Moneda",r=>r.moneda??"PES"), field(10,107,116,"N","Tipo de cambio",r=>Math.round((r.tipoCambio??1)*1_000_000)),
  field(11,117,117,"N","Alícuotas",r=>r.cantidadAlicuotas??0), field(12,118,132,"N","Crédito fiscal",r=>r.creditoFiscalCents??0),
  filler(13,133,325),
];
export const COMPRAS_ALICUOTAS: FixedField<AlicuotaRow>[] = [
  field(1,1,3,"N","Tipo",r=>r.tipoCbte), field(2,4,8,"N","Punto de venta",r=>r.puntoVenta),
  field(3,9,28,"N","Número",r=>r.numero), field(4,29,40,"N","Documento",r=>r.docNro??"0"),
  field(5,41,55,"N","Neto",r=>r.netoCents), field(6,56,59,"N","Alícuota",r=>r.codigo),
  field(7,60,74,"N","IVA",r=>r.ivaCents), filler(8,75,84),
];
// Ventas usa la estructura declarativa y queda identificada para reemplazarla si ARCA modifica el PDF.
export const VENTAS_CBTE: FixedField<LibroRow>[] = [
  field(1,1,8,"N","Fecha",r=>r.fecha.replaceAll("-","")), field(2,9,11,"N","Tipo",r=>r.tipoCbte),
  field(3,12,16,"N","Punto de venta",r=>r.puntoVenta), field(4,17,36,"N","Desde",r=>r.numeroDesde),
  field(5,37,56,"N","Hasta",r=>r.numeroHasta), field(6,57,58,"N","Documento",r=>r.docTipo),
  field(7,59,78,"N","Número documento",r=>r.docNro), field(8,79,108,"A","Denominación",r=>r.denominacion),
  field(9,109,123,"N","Total",r=>r.totalCents), field(10,124,126,"A","Moneda",r=>r.moneda??"PES"),
  field(11,127,136,"N","Tipo de cambio",r=>Math.round((r.tipoCambio??1)*1_000_000)), field(12,137,137,"N","Alícuotas",r=>r.cantidadAlicuotas??0),
  filler(13,138,266),
];
export const VENTAS_ALICUOTAS: FixedField<AlicuotaRow>[] = [
  field(1,1,3,"N","Tipo",r=>r.tipoCbte), field(2,4,8,"N","Punto de venta",r=>r.puntoVenta),
  field(3,9,28,"N","Número",r=>r.numero), field(4,29,43,"N","Neto",r=>r.netoCents),
  field(5,44,47,"N","Alícuota",r=>r.codigo), field(6,48,62,"N","IVA",r=>r.ivaCents),
];
export const IMPORTACION_BIENES_ALICUOTA: FixedField<AlicuotaRow>[] = [
  field(1,1,16,"A","Despacho",r=>r.numero), field(2,17,31,"N","Neto",r=>r.netoCents),
  field(3,32,35,"N","Alícuota",r=>r.codigo), field(4,36,50,"N","IVA",r=>r.ivaCents),
];

export function formatFixed<T>(row: T, fields: FixedField<T>[]) {
  const length = fields.at(-1)?.hasta ?? 0;
  let line = "";
  for (const spec of fields) {
    if (spec.desde !== line.length + 1) throw new Error(`Diseño discontinuo en ${spec.nombre}`);
    const width = spec.hasta - spec.desde + 1;
    let value = String(spec.value(row) ?? "");
    if (value.length > width) throw new Error(`${spec.nombre} excede ${width} posiciones`);
    value = spec.tipo === "N"
      ? (value.startsWith("-") ? `-${value.slice(1).padStart(width - 1, "0")}` : value.padStart(width, "0"))
      : value.padEnd(width, " ");
    line += value;
  }
  if (line.length !== length) throw new Error(`Línea inválida: ${line.length}; se esperaban ${length}`);
  return line;
}
export function makeTxt<T>(rows: T[], fields: FixedField<T>[]) {
  const lines = rows.map((row) => formatFixed(row, fields));
  const expected = fields.at(-1)?.hasta ?? 0;
  if (lines.some((line) => line.length !== expected)) throw new Error("El archivo contiene líneas de largo inválido");
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
}
