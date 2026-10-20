import { isValidCuit, cuitDigits } from "../fiscal/cuit";
import type { TaxCondition } from "../fiscal/letter";
import { detectProfile, normalizeHeader, type EntityKey } from "./fields";

export type RowIssue = { level: "error" | "warning"; message: string };

export type ReviewedRow = {
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
  missingIva: boolean;
  key: string;
};

const AFIP_TYPES: Record<string, { letter: "A" | "B" | "C"; code: string }> = {
  "1": { letter: "A", code: "FAC" },
  "2": { letter: "A", code: "ND" },
  "3": { letter: "A", code: "NCR" },
  "6": { letter: "B", code: "FAC" },
  "7": { letter: "B", code: "ND" },
  "8": { letter: "B", code: "NCR" },
  "11": { letter: "C", code: "FAC" },
  "12": { letter: "C", code: "ND" },
  "13": { letter: "C", code: "NCR" },
};

export function applyMapping(columns: string[], row: string[], mapping: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  columns.forEach((column, index) => {
    const target = mapping[column];
    if (!target) return;
    const cell = row[index] ?? "";
    if (values[target]) values[target] = `${values[target]} ${cell}`.trim();
    else values[target] = cell.trim();
  });
  return values;
}

export function suggestTaxCondition(cuit: string): TaxCondition | null {
  const digits = cuitDigits(cuit);
  if (digits.length !== 11) return digits.length === 0 ? "cf" : null;
  const prefix = digits.slice(0, 2);
  if (prefix === "30" || prefix === "33" || prefix === "34") return "ri";
  if (prefix === "20" || prefix === "23" || prefix === "24" || prefix === "27") return "monotributo";
  return null;
}

export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = trimmed.replace(/\s/g, "").replace(/\$/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function parseTaxCondition(value: string | undefined): TaxCondition | "" {
  if (!value) return "";
  const normal = normalizeHeader(value);
  if (!normal) return "";
  if (["ri", "responsable inscripto", "inscripto"].includes(normal)) return "ri";
  if (["mono", "monotributo", "monotributista", "responsable monotributo", "mt"].includes(normal)) return "monotributo";
  if (["cf", "consumidor final", "consumidor"].includes(normal)) return "cf";
  if (["exento", "ex", "iva exento"].includes(normal)) return "exento";
  return "";
}

export function fillIva(values: Record<string, string>, mode: "manual" | "regla" | "bloque", bloque?: TaxCondition): Record<string, string> {
  if (values.condicion_iva) return values;
  if (mode === "regla") {
    const suggested = suggestTaxCondition(values.cuit ?? "");
    return suggested ? { ...values, condicion_iva: suggested } : values;
  }
  if (mode === "bloque" && bloque) return { ...values, condicion_iva: bloque };
  return values;
}

export function reviewRow(args: {
  entity: EntityKey;
  columns: string[];
  row: string[];
  mapping: Record<string, string>;
  seen: Set<string>;
  existing: Set<string>;
  ivaMode?: "manual" | "regla" | "bloque";
  ivaBloque?: TaxCondition;
}): ReviewedRow {
  const profile = detectProfile(args.columns);
  let values = applyMapping(args.columns, args.row, args.mapping);
  if (profile && (args.entity === "ventas" || args.entity === "compras")) {
    values = { ...arcaAmounts(args.columns, args.row), ...stripEmpty(values) };
    if (!values.tipo && values.tipo_afip && AFIP_TYPES[values.tipo_afip]) values.tipo = AFIP_TYPES[values.tipo_afip].code;
    if (!values.letra && values.tipo_afip && AFIP_TYPES[values.tipo_afip]) values.letra = AFIP_TYPES[values.tipo_afip].letter;
  }
  values = fillIva(values, args.ivaMode ?? "manual", args.ivaBloque);
  if (values.condicion_iva && parseTaxCondition(values.condicion_iva)) {
    values.condicion_iva = parseTaxCondition(values.condicion_iva);
  }
  const issues = issuesFor(args.entity, values);
  const key = rowKey(args.entity, values);
  const duplicate = key ? args.seen.has(key) || args.existing.has(key) : false;
  if (key) args.seen.add(key);
  if (duplicate) issues.push({ level: "warning", message: "Ya existe un registro con la misma clave. Elegí si lo actualizás, lo omitís o lo creás de nuevo." });
  const parsedIva = values.condicion_iva ? parseTaxCondition(values.condicion_iva) : "";
  const missingIva = (args.entity === "clientes" || args.entity === "proveedores") && (!values.condicion_iva || !parsedIva);
  if ((args.entity === "clientes" || args.entity === "proveedores") && !values.condicion_iva) {
    issues.push({ level: "warning", message: "Falta la condición frente al IVA." });
  }
  return {
    values,
    errors: issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
    warnings: issues.filter((issue) => issue.level === "warning").map((issue) => issue.message),
    duplicate,
    missingIva,
    key,
  };
}

function stripEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
}

export function arcaAmounts(columns: string[], row: string[]): Record<string, string> {
  let neto = 0;
  let iva = 0;
  let exento = 0;
  let noGravado = 0;
  let otros = 0;
  let total = 0;
  let sawNeto = false;
  let sawIva = false;
  columns.forEach((column, index) => {
    const name = normalizeHeader(column);
    const cents = parseAmount(row[index] ?? "");
    if (cents == null) return;
    if (name.includes("importe neto gravado") || name.includes("imp neto gravado")) {
      neto += cents;
      sawNeto = true;
    } else if (name === "iva" || name.startsWith("iva ") || name === "total iva") {
      iva += cents;
      sawIva = true;
    } else if (name.includes("exenta")) exento += cents;
    else if (name.includes("no gravado")) noGravado += cents;
    else if (name.includes("otros tributos")) otros += cents;
    else if (name === "importe total" || name === "imp total" || name === "total") total = cents;
  });
  const out: Record<string, string> = {};
  if (sawNeto) out.neto = (neto / 100).toFixed(2);
  if (sawIva) out.iva = (iva / 100).toFixed(2);
  if (exento) out.exento = (exento / 100).toFixed(2);
  if (noGravado) out.no_gravado = (noGravado / 100).toFixed(2);
  if (otros) out.otros = (otros / 100).toFixed(2);
  if (total) out.total = (total / 100).toFixed(2);
  return out;
}

function issuesFor(entity: EntityKey, values: Record<string, string>): RowIssue[] {
  const issues: RowIssue[] = [];
  if (entity === "clientes" || entity === "proveedores") {
    if (!values.nombre) issues.push({ level: "error", message: "Falta el nombre." });
    if (values.cuit && !isValidCuit(values.cuit)) issues.push({ level: "error", message: "El CUIT no cierra: revisá el dígito verificador." });
    const condition = values.condicion_iva ? parseTaxCondition(values.condicion_iva) : "";
    if (values.condicion_iva && !condition) issues.push({ level: "error", message: "La condición de IVA no se entiende." });
    const prefix = cuitDigits(values.cuit ?? "").slice(0, 2);
    if (condition === "cf" && (prefix === "30" || prefix === "33" || prefix === "34")) {
      issues.push({ level: "warning", message: "El CUIT es de una empresa y la condición figura como consumidor final." });
    }
    if (condition === "ri" && !values.cuit) issues.push({ level: "warning", message: "Un responsable inscripto sin CUIT va a ser difícil de facturar." });
  }
  if (entity === "articulos") {
    if (!values.sku) issues.push({ level: "error", message: "Falta el SKU." });
    if (!values.nombre) issues.push({ level: "error", message: "Falta el nombre." });
    if (values.iva && rateBps(values.iva) == null) issues.push({ level: "error", message: "La alícuota de IVA no se entiende." });
  }
  if (entity === "listas") {
    if (!values.sku || !values.lista_precios || !values.precio) issues.push({ level: "error", message: "Hacen falta la lista, el SKU y el precio." });
  }
  if (entity === "stock") {
    if (!values.sku || !values.deposito || !values.cantidad) issues.push({ level: "error", message: "Hacen falta el SKU, el depósito y la cantidad." });
  }
  if (entity === "plan") {
    if (!values.codigo || !values.nombre) issues.push({ level: "error", message: "Hacen falta el código y el nombre de la cuenta." });
  }
  if (entity === "ventas" || entity === "compras") {
    if (!values.fecha) issues.push({ level: "error", message: "Falta la fecha." });
    if (!values.numero) issues.push({ level: "error", message: "Falta el número." });
    if (!values.nombre && !values.cuit) issues.push({ level: "error", message: "Falta el cliente o el proveedor." });
    if (values.cuit && !isValidCuit(values.cuit)) issues.push({ level: "error", message: "El CUIT no cierra: revisá el dígito verificador." });
    const neto = parseAmount(values.neto ?? "") ?? 0;
    const iva = parseAmount(values.iva ?? "") ?? 0;
    const exento = parseAmount(values.exento ?? "") ?? 0;
    const noGravado = parseAmount(values.no_gravado ?? "") ?? 0;
    const percepciones = parseAmount(values.percepciones ?? "") ?? 0;
    const otros = parseAmount(values.otros ?? "") ?? 0;
    const total = parseAmount(values.total ?? "");
    if (total == null) issues.push({ level: "error", message: "Falta el total." });
    else if (Math.abs(neto + iva + exento + noGravado + percepciones + otros - total) > 1) {
      issues.push({ level: "error", message: "El total no cierra con el neto, el IVA y los tributos." });
    }
  }
  return issues;
}

export function rateBps(value: string): number | null {
  const amount = Number(value.replace("%", "").replace(",", ".").trim());
  if (!Number.isFinite(amount)) return null;
  if (amount > 100) return Math.round(amount);
  return Math.round(amount * 100);
}

export function rowKey(entity: EntityKey, values: Record<string, string>): string {
  if (entity === "clientes" || entity === "proveedores") {
    const cuit = cuitDigits(values.cuit ?? "");
    if (cuit.length === 11) return `cuit:${cuit}`;
    if (values.codigo) return `code:${values.codigo.toLowerCase()}`;
    return values.nombre ? `name:${values.nombre.toLowerCase()}` : "";
  }
  if (entity === "articulos" || entity === "listas" || entity === "stock") {
    return [values.lista_precios, values.deposito, values.sku].filter(Boolean).join("|").toLowerCase();
  }
  if (entity === "plan") return (values.codigo ?? "").toLowerCase();
  if (entity === "ventas" || entity === "compras") {
    return [values.tipo, values.letra, values.punto_venta, values.numero, cuitDigits(values.cuit ?? "")].join("|").toLowerCase();
  }
  return "";
}

export function totalsClose(neto: number, iva: number, exento: number, noGravado: number, percepciones: number, otros: number, total: number): boolean {
  return Math.abs(neto + iva + exento + noGravado + percepciones + otros - total) <= 1;
}
