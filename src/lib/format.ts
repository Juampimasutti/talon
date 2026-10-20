const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** Contado menos vendido. Negativo es faltante (falta plata); positivo es sobrante. */
export function cajaDifference(soldCents: number, collectedCents: number): { cents: number; label: "faltante" | "sobrante" | "coincide" } {
  const cents = collectedCents - soldCents;
  if (cents < 0) return { cents, label: "faltante" };
  if (cents > 0) return { cents, label: "sobrante" };
  return { cents: 0, label: "coincide" };
}

/** El sobrante lleva signo más. El faltante ya viene con el menos de la moneda. */
export function signedMoney(cents: number): string {
  if (cents > 0) return `+${formatMoney(cents)}`;
  return formatMoney(cents);
}

export function cajaDifferenceText(soldCents: number, collectedCents: number): string {
  const gap = cajaDifference(soldCents, collectedCents);
  if (gap.label === "coincide") return "La caja cierra en cero.";
  return `Diferencia ${signedMoney(gap.cents)} (${gap.label})`;
}

/** Caja abierta del usuario, o la primera caja (no un banco). Vacío si no hay caja. */
export function preferredCashAccountId(accounts: { id: string; kind: string }[], rememberedId: string | null | undefined): string {
  const drawers = accounts.filter((account) => account.kind === "caja");
  if (rememberedId && drawers.some((account) => account.id === rememberedId)) return rememberedId;
  return drawers[0]?.id ?? "";
}

/** Saldo con el signo en palabras. Positivo: nos deben o debemos. Negativo: saldo a favor. */
export function balancePhrase(side: "cliente" | "proveedor", cents: number): string {
  const abs = formatMoney(Math.abs(cents));
  if (cents === 0) return "En cero";
  if (side === "proveedor") return cents > 0 ? `Debemos ${abs}` : `Saldo a favor nuestro ${abs}`;
  return cents > 0 ? `Nos debe ${abs}` : `Saldo a favor del cliente ${abs}`;
}

export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("es-AR").format(value);
  }
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return dateTime.format(date);
}

export function formatNumber(pointOfSale: number, number: number): string {
  return `${String(pointOfSale).padStart(4, "0")}-${String(number).padStart(8, "0")}`;
}

/** El número que se muestra: el del proveedor en una compra, el nuestro en el resto. */
export function fiscalNumber(doc: { kind?: string; pointOfSale: number; number: number; supplierPos?: number | null; supplierNumber?: number | null }): string {
  if (doc.kind === "compra" && doc.supplierNumber) return formatNumber(doc.supplierPos ?? 0, doc.supplierNumber);
  return formatNumber(doc.pointOfSale, doc.number);
}

export function conceptoError(value: string, min = 3): string | null {
  const letters = value.trim().match(/\p{L}/gu)?.length ?? 0;
  if (letters < min) return `Escribí un concepto (mínimo ${min} letras)`;
  return null;
}

export function formatQty(value: number): string {
  return value.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

export function countNoun(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("es-AR")} ${count === 1 ? singular : plural}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  cuenta_corriente: "Cuenta corriente",
  contado: "Contado",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  qr: "QR",
  vale: "Vale",
};

export function paymentLabel(value: string): string {
  return PAYMENT_LABELS[value] ?? value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

const BUSINESS_TZ = "America/Argentina/Buenos_Aires";

export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatMeasure(quantity: number, unit: string): string {
  const amount = formatQty(quantity);
  const normalized = unit.trim().toLowerCase();
  if (normalized === "litro" || normalized === "litros" || normalized === "l") {
    return `${amount} ${Math.abs(quantity - 1) < 0.0005 ? "litro" : "litros"}`;
  }
  if (normalized === "m3" || normalized === "m³") return `${amount} m³`;
  if (normalized === "u" || normalized === "unidad" || normalized === "unidades") {
    return `${amount} ${Math.abs(quantity - 1) < 0.0005 ? "unidad" : "unidades"}`;
  }
  return `${amount} ${unit}`;
}

/**
 * Lee un número como lo escribe alguien en Argentina.
 * La coma es decimal. El punto es miles si hay coma, o si el grupo es 1.234 / 1.234.567.
 * Un punto suelto con otra cantidad de decimales sigue siendo punto decimal ("10.5").
 */
export function parseLocaleNumber(value: string): number | null {
  let cleaned = value.trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!cleaned) return null;
  const negative = cleaned.startsWith("-");
  if (negative || cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(",")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

/** Número que viene de Postgres (`5.000` son 5 litros, no cinco mil). */
export function parseDbNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function parseInputNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseLocaleNumber(value);
  return null;
}

export function parseMoneyToCents(value: string): number | null {
  const amount = parseLocaleNumber(value);
  if (amount == null || amount < 0) return null;
  return Math.round(amount * 100);
}
