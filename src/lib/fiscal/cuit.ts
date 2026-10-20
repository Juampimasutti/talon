const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export function cuitDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Dígito verificador AFIP para los primeros 10 dígitos. */
export function cuitCheckDigit(base10: string): number {
  if (!/^\d{10}$/.test(base10)) {
    throw new Error("La base del CUIT tiene que tener 10 dígitos");
  }
  const sum = base10.split("").reduce((acc, char, index) => acc + Number(char) * WEIGHTS[index], 0);
  const raw = 11 - (sum % 11);
  if (raw === 11) return 0;
  if (raw === 10) return 9;
  return raw;
}

export function isValidCuit(value: string): boolean {
  const digits = cuitDigits(value);
  if (digits.length !== 11) return false;
  return Number(digits[10]) === cuitCheckDigit(digits.slice(0, 10));
}

export function formatCuit(value: string): string {
  const digits = cuitDigits(value);
  if (digits.length !== 11) return value.trim();
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export function buildCuit(prefix: string, middle: string): string {
  const base = `${prefix}${middle}`;
  if (!/^\d{10}$/.test(base)) {
    throw new Error("Prefijo y cuerpo del CUIT tienen que sumar 10 dígitos");
  }
  return `${base}${cuitCheckDigit(base)}`;
}
