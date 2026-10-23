export type LineaFiscal = {
  signo?: 1 | -1;
  libro: "ventas" | "compras";
  ivaCents: number;
  creditoComputableCents?: number;
  percepIvaCents?: number;
  tipoOperacion?: string;
  /** Tipo de cambio ARCA. Los importes se conservan en moneda original y se convierten por línea. */
  tipoCambio?: number;
};

export function convertirCentsAPesos(cents: number, tipoCambio = 1) {
  return Math.round(cents * tipoCambio);
}

export type AjustesLiquidacion = {
  /** Saldo técnico a favor del período anterior (sólo compensa débito fiscal). */
  saldoTecnicoAnteriorCents?: number;
  /** Saldo de libre disponibilidad a favor del período anterior. */
  saldoLibreAnteriorCents?: number;
  retencionesCents?: number;
  /** Percepciones de IVA sufridas cargadas a mano (se suman a las de los comprobantes). */
  percepcionesCents?: number;
  pagosCuentaCents?: number;
  /** Contribuciones de seguridad social computables (Dec. 814/01): se suman al crédito fiscal. */
  seguridadSocialCents?: number;
};

export function coeficienteProrrateo(gravadasCents: number, exentasCents: number, noGravadasCents: number) {
  const total = gravadasCents + exentasCents + noGravadasCents;
  return total <= 0 ? 10_000 : Math.round((gravadasCents * 10_000) / total);
}

export function aplicarProrrateo(ivaCents: number, coeficienteBps: number) {
  return Math.round((ivaCents * coeficienteBps) / 10_000);
}

/**
 * F.2002 simplificado. El saldo técnico y el de libre disponibilidad van por separado:
 *   saldo técnico = débito − crédito (incl. Dec. 814) − saldo técnico a favor anterior
 *   si es negativo queda como saldo técnico a favor del contribuyente (no se mezcla con libre).
 *   impuesto determinado (si positivo) − (saldo libre anterior + percepciones + retenciones + pagos a cuenta)
 *   = saldo a pagar, o saldo de libre disponibilidad a favor.
 */
export function calcularLiquidacion(lineas: LineaFiscal[], ajustes: AjustesLiquidacion = {}) {
  const ventas = lineas.filter((l) => l.libro === "ventas");
  const compras = lineas.filter((l) => l.libro === "compras");
  const debitoFiscalCents = ventas.reduce((n, l) => n + convertirCentsAPesos(l.ivaCents, l.tipoCambio) * (l.signo ?? 1), 0);
  const creditoComprasCents = compras.reduce((n, l) => n + convertirCentsAPesos(l.creditoComputableCents ?? l.ivaCents, l.tipoCambio) * (l.signo ?? 1), 0);
  const seguridadSocialCents = ajustes.seguridadSocialCents ?? 0;
  const creditoFiscalCents = creditoComprasCents + seguridadSocialCents;
  const saldoTecnicoCents = debitoFiscalCents - creditoFiscalCents;
  const saldoTecnicoAnteriorCents = ajustes.saldoTecnicoAnteriorCents ?? 0;
  const despuesSaldoTecnicoAnteriorCents = saldoTecnicoCents - saldoTecnicoAnteriorCents;
  const impuestoDeterminadoCents = Math.max(0, despuesSaldoTecnicoAnteriorCents);
  const saldoTecnicoAFavorCents = Math.max(0, -despuesSaldoTecnicoAnteriorCents);
  const percepcionesComprobantesCents = compras.reduce((n, l) => n + convertirCentsAPesos(l.percepIvaCents ?? 0, l.tipoCambio) * (l.signo ?? 1), 0);
  const percepcionesIvaCents = percepcionesComprobantesCents + (ajustes.percepcionesCents ?? 0);
  const saldoLibreAnteriorCents = ajustes.saldoLibreAnteriorCents ?? 0;
  const retencionesCents = ajustes.retencionesCents ?? 0;
  const pagosCuentaCents = ajustes.pagosCuentaCents ?? 0;
  const creditosLibreCents = saldoLibreAnteriorCents + percepcionesIvaCents + retencionesCents + pagosCuentaCents;
  const resultadoCents = impuestoDeterminadoCents - creditosLibreCents;
  return {
    debitoFiscalCents,
    creditoComprasCents,
    seguridadSocialCents,
    creditoFiscalCents,
    saldoTecnicoCents,
    saldoTecnicoAnteriorCents,
    despuesSaldoTecnicoAnteriorCents,
    impuestoDeterminadoCents,
    saldoTecnicoAFavorCents,
    percepcionesComprobantesCents,
    percepcionesIvaCents,
    retencionesCents,
    pagosCuentaCents,
    saldoLibreAnteriorCents,
    creditosLibreCents,
    totalPagarCents: Math.max(0, resultadoCents),
    saldoLibreAFavorCents: Math.max(0, -resultadoCents),
    /** Compatibilidad con borradores anteriores: igual a saldoLibreAFavorCents. */
    saldoFavorCents: Math.max(0, -resultadoCents),
  };
}

export type ResultadoLiquidacion = ReturnType<typeof calcularLiquidacion>;

/** Período anterior AAAAMM. */
export function periodoAnterior(periodo: string) {
  const y = Number(periodo.slice(0, 4)); const m = Number(periodo.slice(4, 6));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`;
}

/** Saldos a favor que arrastra una liquidación confirmada (totales nuevos o viejos). */
export function saldosQueArrastra(totales: Record<string, unknown> | null | undefined) {
  const t = totales ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
  if ("saldoTecnicoAFavorCents" in t) return { saldoTecnicoAnteriorCents: num(t.saldoTecnicoAFavorCents), saldoLibreAnteriorCents: num(t.saldoLibreAFavorCents), formatoViejo: false };
  // Liquidaciones confirmadas antes de separar los saldos: el saldo a favor era de libre disponibilidad.
  return { saldoTecnicoAnteriorCents: 0, saldoLibreAnteriorCents: num(t.saldoFavorCents), formatoViejo: true };
}

/** Renglones de imp_liquidacion_items en el orden del formulario. */
export function itemsLiquidacion(r: ResultadoLiquidacion, manual: Partial<Record<"saldoTecnicoAnterior" | "saldoLibreAnterior" | "percepciones" | "retenciones" | "pagosCuenta" | "seguridadSocial", boolean>> = {}) {
  const o = (m?: boolean) => (m ? "manual" : "calculado") as "manual" | "calculado";
  return [
    { rubro: "debito", concepto: "Débito fiscal", importeCents: r.debitoFiscalCents, origen: o() },
    { rubro: "credito", concepto: "Crédito fiscal de compras", importeCents: r.creditoComprasCents, origen: o() },
    { rubro: "credito", concepto: "Contribuciones seguridad social (Dec. 814/01)", importeCents: r.seguridadSocialCents, origen: o(manual.seguridadSocial) },
    { rubro: "saldo_tecnico", concepto: "Saldo técnico del período", importeCents: r.saldoTecnicoCents, origen: o() },
    { rubro: "saldo_tecnico", concepto: "Saldo técnico a favor del período anterior", importeCents: r.saldoTecnicoAnteriorCents, origen: o(manual.saldoTecnicoAnterior) },
    { rubro: "saldo_tecnico", concepto: "Impuesto determinado", importeCents: r.impuestoDeterminadoCents, origen: o() },
    { rubro: "saldo_tecnico", concepto: "Saldo técnico a favor (pasa al período siguiente)", importeCents: r.saldoTecnicoAFavorCents, origen: o() },
    { rubro: "libre", concepto: "Saldo de libre disponibilidad del período anterior", importeCents: r.saldoLibreAnteriorCents, origen: o(manual.saldoLibreAnterior) },
    { rubro: "libre", concepto: "Percepciones de IVA", importeCents: r.percepcionesIvaCents, origen: o(manual.percepciones) },
    { rubro: "libre", concepto: "Retenciones de IVA", importeCents: r.retencionesCents, origen: o(manual.retenciones) },
    { rubro: "libre", concepto: "Pagos a cuenta", importeCents: r.pagosCuentaCents, origen: o(manual.pagosCuenta) },
    { rubro: "resultado", concepto: "Saldo a pagar", importeCents: r.totalPagarCents, origen: o() },
    { rubro: "resultado", concepto: "Saldo de libre disponibilidad a favor", importeCents: r.saldoLibreAFavorCents, origen: o() },
  ];
}
