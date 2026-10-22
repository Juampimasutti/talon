import { COMPRAS_ALICUOTAS, COMPRAS_CBTE, IMPORTACION_BIENES_ALICUOTA, VENTAS_ALICUOTAS, VENTAS_CBTE, codigoOperacion, discriminaIva, makeTxt, type AlicuotaRow, type LibroRow } from ".";

type Row = Record<string, unknown>;
const IMPORTACION = new Set([66, 67]);
const n = (v: unknown) => Number(v ?? 0);

/**
 * Arma los 5 TXT del Libro IVA Digital a partir de imp_comprobantes / imp_comprobante_alicuotas.
 * Los despachos de importación (tipos 66/67) van en COMPRAS_CBTE con el despacho y sus
 * alícuotas en IMPORTACION_BIENES_ALICUOTA (no en COMPRAS_ALICUOTAS).
 */
export function buildLibroIvaDigital(receipts: Row[], rates: Row[]) {
  const avisos: string[] = [];
  const byReceipt = new Map<unknown, Row[]>();
  for (const rate of rates) byReceipt.set(rate.comprobante_id, [...(byReceipt.get(rate.comprobante_id) ?? []), rate]);
  const ventasCbte: LibroRow[] = []; const ventasAli: AlicuotaRow[] = [];
  const comprasCbte: LibroRow[] = []; const comprasAli: AlicuotaRow[] = []; const importAli: AlicuotaRow[] = [];
  for (const r of receipts) {
    const tipo = n(r.tipo_cbte); const compras = r.libro === "compras"; const importacion = compras && IMPORTACION.has(tipo);
    const alis = (byReceipt.get(r.id) ?? []).map((a) => ({ codigo: n(a.alicuota_codigo), netoCents: n(a.neto_cents), ivaCents: n(a.iva_cents) }));
    // Compras B/C: cantidad de alícuotas 0 y sin registros de alícuotas (instructivo, campo 19).
    const informa = compras ? discriminaIva(tipo) : true;
    const alicuotas = informa ? alis : [];
    const despacho = importacion ? String(r.despacho ?? "").trim() || null : null;
    if (importacion && !despacho) avisos.push(`Despacho ${r.punto_venta}-${r.numero_desde}: falta el número de despacho de importación`);
    const row: LibroRow = {
      fecha: String(r.fecha_cbte instanceof Date ? r.fecha_cbte.toISOString() : r.fecha_cbte), tipoCbte: tipo, puntoVenta: n(r.punto_venta),
      numeroDesde: String(r.numero_desde), numeroHasta: String(r.numero_hasta), despacho,
      docTipo: n(r.doc_tipo), docNro: String(r.doc_nro ?? ""), denominacion: String(r.denominacion ?? ""), totalCents: n(r.total_cents),
      noGravadoCents: n(r.neto_no_gravado_cents), exentoCents: n(r.exento_cents), percepIvaCents: n(r.percep_iva_cents),
      percepOtrosNacCents: n(r.percep_otros_nac_cents), percepIibbCents: n(r.percep_iibb_cents), percepMuniCents: n(r.percep_municipales_cents),
      internosCents: n(r.impuestos_internos_cents), otrosTributosCents: n(r.otros_tributos_cents),
      moneda: String(r.moneda ?? "PES"), tipoCambio: n(r.tipo_cambio) || 1, cantidadAlicuotas: alicuotas.length,
      codigoOperacion: informa ? codigoOperacion({ alicuotas, exentoCents: n(r.exento_cents), noGravadoCents: n(r.neto_no_gravado_cents), importacion }) : "0",
      creditoFiscalCents: n(r.credito_fiscal_computable_cents),
    };
    const ali = alicuotas.map((a) => ({ tipoCbte: tipo, puntoVenta: row.puntoVenta, numero: row.numeroDesde, docTipo: row.docTipo, docNro: row.docNro, despacho, ...a }));
    if (compras) { comprasCbte.push(row); (importacion ? importAli : comprasAli).push(...ali); }
    else { ventasCbte.push(row); ventasAli.push(...ali); }
  }
  return {
    avisos,
    files: {
      LIBRO_IVA_DIGITAL_VENTAS_CBTE: makeTxt(ventasCbte, VENTAS_CBTE),
      LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS: makeTxt(ventasAli, VENTAS_ALICUOTAS),
      LIBRO_IVA_DIGITAL_COMPRAS_CBTE: makeTxt(comprasCbte, COMPRAS_CBTE),
      LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS: makeTxt(comprasAli, COMPRAS_ALICUOTAS),
      LIBRO_IVA_DIGITAL_IMPORTACION_BIENES_ALICUOTA: makeTxt(importAli, IMPORTACION_BIENES_ALICUOTA),
    },
  };
}
