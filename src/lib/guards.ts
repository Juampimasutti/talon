export const MAX_MONEY_CENTS = 100_000_000_00;

export function moneyError(cents: number): string | null {
  if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_MONEY_CENTS) {
    return "El importe tiene que ser mayor a cero y no pasar de 100 millones";
  }
  return null;
}

export function cashOutAllowed(balanceCents: number, amountCents: number, allowNegative: boolean): string | null {
  if (allowNegative) return null;
  if (balanceCents - amountCents < 0) return "La caja no puede quedar en negativo. Si hace falta, activalo en la empresa.";
  return null;
}

export function collectionAllowed(balanceCents: number, amountCents: number, anticipo: boolean): string | null {
  if (anticipo) return null;
  if (amountCents > balanceCents) return "El importe supera el saldo. Marcá anticipo si es un saldo a favor.";
  return null;
}

export function kmAllowed(opening: number | null, closing: number): string | null {
  if (opening != null && closing < opening) return "El kilometraje de cierre no puede ser menor que el de salida";
  return null;
}

/** Patente argentina: ABC123 o AB123CD, sin espacios ni guiones. */
export function plateError(value: string): string | null {
  const plate = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{3}\d{3}$/.test(plate) || /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(plate)) return null;
  return "La patente tiene que ser como ABC123 o AB123CD";
}

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function constraintMessage(code: string, detail: string): string | null {
  const text = detail.toLowerCase();
  if (code === "23505" && text.includes("ledger_accounts")) return "Ya existe una cuenta con ese código";
  if (code === "23505" && text.includes("fuel_trucks")) return "Ya hay un camión con esa patente";
  if (code === "23505" && text.includes("fuel_pumps")) return "Ya hay un surtidor con ese número";
  if (code === "23505" && text.includes("fuel_nozzles")) return "Ya hay un pico con ese número en el surtidor";
  if (code === "23505" && text.includes("fuel_tanks")) return "Ya hay un tanque con ese nombre";
  if (code === "23505" && text.includes("fleet_vehicles")) return "Ya hay un vehículo con esa patente";
  if (code === "23505" && text.includes("cuit") && text.includes("customer")) return "Ya hay un cliente con ese CUIT";
  if (code === "23505" && text.includes("cuit") && text.includes("supplier")) return "Ya hay un proveedor con ese CUIT";
  if (code === "23505" && text.includes("document_types")) return "Ya existe un comprobante con ese código";
  if (code === "23505" && (text.includes("supplier_invoice") || text.includes("supplier_number"))) return "Ese proveedor ya tiene una factura con ese número";
  if (code === "23505" && text.includes("products") && text.includes("sku")) return "Ya existe un artículo con ese código";
  if (code === "23505" && (text.includes("customers") || text.includes("suppliers"))) return "Ya existe una ficha con ese código";
  if (code === "23505") return "Ese dato ya está cargado";
  if (code === "22P02") return "Revisá los datos: hay un identificador que no es válido";
  return null;
}
