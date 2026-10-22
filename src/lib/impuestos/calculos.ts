export type LineaFiscal = {
  signo?: 1 | -1;
  libro: "ventas" | "compras";
  ivaCents: number;
  creditoComputableCents?: number;
  percepIvaCents?: number;
  tipoOperacion?: string;
};

export type AjustesLiquidacion = {
  saldoTecnicoAnteriorCents?: number;
  saldoLibreAnteriorCents?: number;
  retencionesCents?: number;
  pagosCuentaCents?: number;
  seguridadSocialCents?: number;
};

export function coeficienteProrrateo(gravadasCents: number, exentasCents: number, noGravadasCents: number) {
  const total = gravadasCents + exentasCents + noGravadasCents;
  return total <= 0 ? 10_000 : Math.round((gravadasCents * 10_000) / total);
}

export function aplicarProrrateo(ivaCents: number, coeficienteBps: number) {
  return Math.round((ivaCents * coeficienteBps) / 10_000);
}

export function calcularLiquidacion(lineas: LineaFiscal[], ajustes: AjustesLiquidacion = {}) {
  const ventas = lineas.filter((l) => l.libro === "ventas");
  const compras = lineas.filter((l) => l.libro === "compras");
  const debitoFiscalCents = ventas.reduce((n, l) => n + l.ivaCents * (l.signo ?? 1), 0);
  const creditoFiscalCents = compras.reduce(
    (n, l) => n + (l.creditoComputableCents ?? l.ivaCents) * (l.signo ?? 1),
    0,
  ) + (ajustes.seguridadSocialCents ?? 0);
  const saldoTecnicoCents = debitoFiscalCents - creditoFiscalCents;
  const despuesSaldoTecnicoAnteriorCents = saldoTecnicoCents - (ajustes.saldoTecnicoAnteriorCents ?? 0);
  const percepcionesIvaCents = compras.reduce((n, l) => n + (l.percepIvaCents ?? 0) * (l.signo ?? 1), 0);
  const creditosLibreCents = (ajustes.saldoLibreAnteriorCents ?? 0) + percepcionesIvaCents
    + (ajustes.retencionesCents ?? 0) + (ajustes.pagosCuentaCents ?? 0);
  const resultadoCents = despuesSaldoTecnicoAnteriorCents - creditosLibreCents;
  return {
    debitoFiscalCents,
    creditoFiscalCents,
    saldoTecnicoCents,
    despuesSaldoTecnicoAnteriorCents,
    percepcionesIvaCents,
    creditosLibreCents,
    totalPagarCents: Math.max(0, resultadoCents),
    saldoFavorCents: Math.max(0, -resultadoCents),
  };
}
