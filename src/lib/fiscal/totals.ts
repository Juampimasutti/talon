import { priceModeForLetter, type PriceMode } from "./letter";

export type TaxTreatment = "gravado" | "exento" | "no_gravado";

export type LineInput = {
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  ivaRateBps: number;
  taxTreatment: TaxTreatment;
  /** Neto ya redondeado a centavos. No se vuelve a multiplicar por la cantidad. */
  amountCents?: number;
};

export type LineResult = {
  netCents: number;
  vatCents: number;
  exemptCents: number;
  untaxedCents: number;
  totalCents: number;
};

export type PerceptionInput = {
  name: string;
  rateBps: number;
};

export type PerceptionResult = PerceptionInput & {
  baseCents: number;
  amountCents: number;
};

export type VatSlice = {
  rateBps: number;
  netCents: number;
  vatCents: number;
};

export type DocumentTotals = {
  lines: LineResult[];
  netTaxedCents: number;
  netUntaxedCents: number;
  exemptCents: number;
  vatCents: number;
  perceptions: PerceptionResult[];
  perceptionsCents: number;
  otherTaxesCents: number;
  totalCents: number;
  vatBreakdown: VatSlice[];
};

function roundCents(value: number): number {
  return Math.round(value);
}

/** Pedido y remito discriminan el IVA del artículo, igual que el comprobante guardado. */
export function previewPriceMode(kind: string, movesVat: boolean, letter: "A" | "B" | "C" | null): PriceMode {
  if (kind === "pedido" || kind === "remito") return "net";
  return priceModeForLetter(letter, movesVat);
}

export function previewKeepsVat(kind: string, movesVat: boolean): boolean {
  return movesVat || kind === "pedido" || kind === "remito";
}

/** Pedido, remito y factura usan la percepción del cliente si el formulario no cargó otra. */
export function documentPerceptions(args: {
  kind: string;
  partyBps: number | null;
  explicit?: PerceptionInput[];
}): PerceptionInput[] {
  const typed = (args.explicit ?? []).filter((item) => item.rateBps > 0);
  if (typed.length) return typed;
  const applies = args.kind === "venta" || args.kind === "pedido" || args.kind === "remito";
  if (!applies || !args.partyBps || args.partyBps <= 0) return [];
  return [{ name: "Percepción IIBB", rateBps: args.partyBps }];
}

export function discountedAmount(quantity: number, unitPriceCents: number, discountBps: number): number {
  return roundCents((quantity * unitPriceCents * (10_000 - discountBps)) / 10_000);
}

export function calcLine(input: LineInput, priceMode: PriceMode): LineResult {
  const amount = input.amountCents != null ? roundCents(input.amountCents) : discountedAmount(input.quantity, input.unitPriceCents, input.discountBps);

  if (input.taxTreatment === "exento") {
    return { netCents: 0, vatCents: 0, exemptCents: amount, untaxedCents: 0, totalCents: amount };
  }

  if (priceMode === "sin_iva" || input.taxTreatment === "no_gravado") {
    return { netCents: 0, vatCents: 0, exemptCents: 0, untaxedCents: amount, totalCents: amount };
  }

  if (input.ivaRateBps <= 0) {
    return { netCents: amount, vatCents: 0, exemptCents: 0, untaxedCents: 0, totalCents: amount };
  }

  if (priceMode === "gross") {
    const netCents = roundCents((amount * 10_000) / (10_000 + input.ivaRateBps));
    const vatCents = amount - netCents;
    return { netCents, vatCents, exemptCents: 0, untaxedCents: 0, totalCents: amount };
  }

  const vatCents = roundCents((amount * input.ivaRateBps) / 10_000);
  return {
    netCents: amount,
    vatCents,
    exemptCents: 0,
    untaxedCents: 0,
    totalCents: amount + vatCents,
  };
}

export function calcDocument(args: {
  lines: LineInput[];
  priceMode: PriceMode;
  perceptions?: PerceptionInput[];
  otherTaxesCents?: number;
}): DocumentTotals {
  const lines = args.lines.map((line) => calcLine(line, args.priceMode));
  const netTaxedCents = lines.reduce((sum, line) => sum + line.netCents, 0);
  const netUntaxedCents = lines.reduce((sum, line) => sum + line.untaxedCents, 0);
  const exemptCents = lines.reduce((sum, line) => sum + line.exemptCents, 0);
  const vatCents = lines.reduce((sum, line) => sum + line.vatCents, 0);

  const slices = new Map<number, VatSlice>();
  args.lines.forEach((input, index) => {
    const line = lines[index];
    if (line.vatCents === 0 && line.netCents === 0) return;
    if (input.taxTreatment !== "gravado") return;
    const current = slices.get(input.ivaRateBps) ?? { rateBps: input.ivaRateBps, netCents: 0, vatCents: 0 };
    current.netCents += line.netCents;
    current.vatCents += line.vatCents;
    slices.set(input.ivaRateBps, current);
  });

  const perceptions = (args.perceptions ?? [])
    .filter((item) => item.rateBps > 0)
    .map((item) => ({
      ...item,
      baseCents: netTaxedCents,
      amountCents: roundCents((netTaxedCents * item.rateBps) / 10_000),
    }));
  const perceptionsCents = perceptions.reduce((sum, item) => sum + item.amountCents, 0);
  const otherTaxesCents = args.otherTaxesCents ?? 0;
  const totalCents = netTaxedCents + netUntaxedCents + exemptCents + vatCents + perceptionsCents + otherTaxesCents;

  return {
    lines,
    netTaxedCents,
    netUntaxedCents,
    exemptCents,
    vatCents,
    perceptions,
    perceptionsCents,
    otherTaxesCents,
    totalCents,
    vatBreakdown: [...slices.values()].sort((a, b) => b.rateBps - a.rateBps),
  };
}
