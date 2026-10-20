/** Un impuesto por código: el vigente, no la suma de todos los precios históricos. */
export const CURRENT_FUEL_TAXES_SQL = `(select coalesce(json_agg(json_build_object('code', code, 'name', name, 'centsPerUnit', cents_per_unit, 'inVatBase', in_vat_base, 'treatment', treatment)), '[]'::json) from (select distinct on (code) code, name, cents_per_unit, in_vat_base, treatment from fuel_taxes where product_id = p.id and valid_from <= now() order by code, valid_from desc) latest_tax)`;

export type FuelTax = {
  code: string;
  name: string;
  centsPerUnit: number;
  /** Si es falso, se resta del precio de surtidor antes de calcular el IVA. */
  inVatBase: boolean;
  treatment: "no_gravado" | "interno";
};

export type PumpSplit = {
  quantity: number;
  grossCents: number;
  vatBaseCents: number;
  vatCents: number;
  taxes: { code: string; name: string; treatment: FuelTax["treatment"]; amountCents: number }[];
  taxCents: number;
  totalCents: number;
};

export function roundLiters(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function litersSold(opening: number, closing: number): number {
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) {
    throw new Error("El aforador tiene que ser un número");
  }
  if (closing < opening) {
    throw new Error("El cierre no puede ser menor que el inicio");
  }
  return roundLiters(closing - opening);
}

export function amountForVolume(volume: number, pricePerUnitCents: number): number {
  return Math.round(volume * pricePerUnitCents);
}

/**
 * Parte un precio de surtidor (final) en base de IVA, IVA e impuestos por unidad.
 * ITC y CO2, por defecto, no integran la base del IVA: se descuentan del precio
 * final y el resto se divide por 1 + alícuota.
 */
/** Si el SQL trae dos ITC vigentes, queda uno solo. Si no, el tributo se duplica. */
export function oneTaxPerCode<T extends { code: string }>(rows: T[]): T[] {
  const byCode = new Map<string, T>();
  for (const row of rows) byCode.set(row.code, row);
  return [...byCode.values()];
}

/** Parte un bruto ya cobrado (el vale) sin volver a usar el precio de hoy. */
export function splitGrossSale(args: {
  quantity: number;
  grossCents: number;
  ivaRateBps: number;
  taxes: FuelTax[];
}): PumpSplit {
  const quantity = roundLiters(args.quantity);
  const taxes = oneTaxPerCode(args.taxes).map((tax) => ({
    code: tax.code,
    name: tax.name,
    treatment: tax.treatment,
    amountCents: amountForVolume(quantity, tax.centsPerUnit),
    inVatBase: tax.inVatBase,
  }));
  const outside = taxes.filter((tax) => !tax.inVatBase).reduce((sum, tax) => sum + tax.amountCents, 0);
  const remainder = args.grossCents - outside;
  const vatBaseCents = args.ivaRateBps > 0 ? Math.round((remainder * 10_000) / (10_000 + args.ivaRateBps)) : remainder;
  const vatCents = remainder - vatBaseCents;
  const taxCents = taxes.reduce((sum, tax) => sum + tax.amountCents, 0);
  return {
    quantity,
    grossCents: args.grossCents,
    vatBaseCents,
    vatCents,
    taxes: taxes.map(({ code, name, treatment, amountCents }) => ({ code, name, treatment, amountCents })),
    taxCents,
    totalCents: vatBaseCents + vatCents + taxCents,
  };
}

export function splitPumpSale(args: {
  quantity: number;
  pumpPriceCents: number;
  ivaRateBps: number;
  taxes: FuelTax[];
}): PumpSplit {
  const quantity = roundLiters(args.quantity);
  const grossCents = amountForVolume(quantity, args.pumpPriceCents);
  const taxes = oneTaxPerCode(args.taxes).map((tax) => ({
    code: tax.code,
    name: tax.name,
    treatment: tax.treatment,
    amountCents: amountForVolume(quantity, tax.centsPerUnit),
    inVatBase: tax.inVatBase,
  }));
  const outside = taxes.filter((tax) => !tax.inVatBase).reduce((sum, tax) => sum + tax.amountCents, 0);
  const remainder = grossCents - outside;
  const vatBaseCents = args.ivaRateBps > 0 ? Math.round((remainder * 10_000) / (10_000 + args.ivaRateBps)) : remainder;
  const vatCents = remainder - vatBaseCents;
  const taxCents = taxes.reduce((sum, tax) => sum + tax.amountCents, 0);
  return {
    quantity,
    grossCents,
    vatBaseCents,
    vatCents,
    taxes: taxes.map(({ code, name, treatment, amountCents }) => ({ code, name, treatment, amountCents })),
    taxCents,
    totalCents: vatBaseCents + vatCents + taxCents,
  };
}

/**
 * Renglón de combustible cuyo total es el precio de surtidor, impuestos incluidos.
 * Factura y remito abren IVA y tributos, y el total sigue siendo el bruto del surtidor.
 */
export function fuelSaleDraft(args: {
  description: string;
  liters: number;
  pumpPriceCents: number;
  ivaRateBps: number;
  taxes: FuelTax[];
  invoice: boolean;
  sku?: string | null;
}) {
  void args.invoice;
  const split = splitPumpSale({ quantity: args.liters, pumpPriceCents: args.pumpPriceCents, ivaRateBps: args.ivaRateBps, taxes: args.taxes });
  const parts = pumpInvoiceParts(split, args.ivaRateBps);
  return {
    line: {
      description: args.description,
      sku: args.sku ?? null,
      quantity: split.quantity,
      unitPriceCents: Math.max(1, Math.round(parts.netCents / Math.max(split.quantity, 0.001))),
      discountBps: 0,
      amountCents: parts.netCents,
      ivaRateBps: args.ivaRateBps,
    },
    otherTaxesCents: parts.otherTaxesCents,
    grossCents: parts.totalCents,
  };
}

/** Parte el surtidor en centavos enteros para que el total del comprobante coincida con el vale. */
export function pumpInvoiceParts(split: PumpSplit, ivaRateBps: number) {
  const netCents = split.vatBaseCents;
  const vatCents = Math.round((netCents * ivaRateBps) / 10_000);
  const otherTaxesCents = split.grossCents - netCents - vatCents;
  return { netCents, vatCents, otherTaxesCents, totalCents: netCents + vatCents + otherTaxesCents };
}

/** Acepta timestamptz de Postgres (`2026-10-19 16:23:00+00`) y ISO. */
export function parseInstant(value: string): number {
  let trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  if (!trimmed.includes("T")) trimmed = trimmed.replace(" ", "T");
  trimmed = trimmed.replace(
    /(\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-])(\d{2})(\d{2})?$/,
    (_match, time: string, sign: string, hours: string, minutes?: string) => `${time}${sign}${hours}:${minutes ?? "00"}`,
  );
  return Date.parse(trimmed);
}

/** Intervalo (desde, hasta]. */
export function inPeriod(at: string, from: string, to: string): boolean {
  const instant = parseInstant(at);
  const end = parseInstant(to);
  if (!Number.isFinite(instant) || !Number.isFinite(end)) return false;
  const start = parseInstant(from);
  if (!Number.isFinite(start)) return instant <= end;
  return instant > start && instant <= end;
}

export function windowLiters(movements: { at: string; liters: number }[], from: string, to: string): number {
  return roundLiters(movements.reduce((sum, movement) => sum + (inPeriod(movement.at, from, to) ? movement.liters : 0), 0));
}

/** Si hubo un cambio de aforador después del último cierre, el turno abre en esa lectura. */
export function openingAfterReset(lastClosing: number | null, lastAt: string | null, resets: { at: string; reading: number }[]): number {
  const later = resets
    .filter((reset) => !lastAt || reset.at > lastAt)
    .sort((a, b) => a.at.localeCompare(b.at));
  const newest = later.at(-1);
  if (newest) return newest.reading;
  return lastClosing ?? 0;
}

export function reconcileTank(args: {
  previousStick: number;
  deliveries: number;
  sold: number;
  currentStick: number;
}): { theoretical: number; variance: number; shrinkage: number } {
  const theoretical = roundLiters(args.previousStick + args.deliveries - args.sold);
  const variance = roundLiters(args.currentStick - theoretical);
  return { theoretical, variance, shrinkage: variance < 0 ? roundLiters(-variance) : 0 };
}

export function priceAt(prices: { validFrom: string; cents: number }[], at: string): number | null {
  const target = new Date(at).getTime();
  let chosen: { validFrom: string; cents: number } | null = null;
  for (const price of prices) {
    if (new Date(price.validFrom).getTime() <= target && (!chosen || price.validFrom > chosen.validFrom)) chosen = price;
  }
  return chosen?.cents ?? null;
}

export function shiftGap(args: { fuelCents: number; shopCents: number; collectedCents: number; invoicedCents: number }) {
  const soldCents = args.fuelCents + args.shopCents;
  return {
    soldCents,
    collectedDifference: soldCents - args.collectedCents,
    invoiceDifference: soldCents - args.invoicedCents,
  };
}

export function shiftBoard(args: { fuelCents: number; shopCents: number; collectedCents: number; invoicedCents: number; paymentsEntered: boolean }) {
  const gap = shiftGap(args);
  return {
    soldCents: gap.soldCents,
    collectedDifference: args.paymentsEntered ? gap.collectedDifference : null,
    invoiceDifference: args.invoicedCents > 0 ? gap.invoiceDifference : null,
  };
}

export function fuelShown(liveCents: number, savedCents: number, typing: boolean): number {
  return typing ? liveCents : savedCents;
}

export function withinCapacity(capacity: number, projected: number): boolean {
  return projected <= capacity + 0.0005;
}
