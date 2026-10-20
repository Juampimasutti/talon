export const TAX_CONDITIONS = ["ri", "monotributo", "cf", "exento"] as const;
export type TaxCondition = (typeof TAX_CONDITIONS)[number];

export function isTaxCondition(value: string): value is TaxCondition {
  return (TAX_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Letra del comprobante según emisor y receptor.
 * Responsable inscripto a responsable inscripto: A.
 * Responsable inscripto al resto: B.
 * Monotributo, exento o consumidor final como emisor: C.
 */
export function resolveLetter(issuer: TaxCondition, receiver: TaxCondition): "A" | "B" | "C" {
  if (issuer !== "ri") return "C";
  if (receiver === "ri") return "A";
  return "B";
}

/** Pedido y remito muestran la misma letra que la factura, aunque no sean comprobantes fiscales. */
export function documentLetter(kind: string, movesVat: boolean, issuer: TaxCondition, receiver: TaxCondition): "A" | "B" | "C" | null {
  if (!movesVat && kind !== "pedido" && kind !== "remito") return null;
  return resolveLetter(issuer, receiver);
}

export type PriceMode = "net" | "gross" | "sin_iva";

export function priceModeForLetter(letter: "A" | "B" | "C" | null, movesVat: boolean): PriceMode {
  // A y B discriminan IVA: el precio de lista es neto y el IVA se suma.
  // C (monotributo o exento) no discrimina.
  if (!movesVat || letter === null || letter === "C") return "sin_iva";
  return "net";
}
