import type { TaxCondition } from "./letter";

export const TAX_CONDITION_LABELS: { value: TaxCondition; label: string }[] = [
  { value: "ri", label: "Responsable inscripto" },
  { value: "monotributo", label: "Monotributo" },
  { value: "cf", label: "Consumidor final" },
  { value: "exento", label: "Exento" },
];

export const IVA_RATES: { bps: number; label: string }[] = [
  { bps: 0, label: "0%" },
  { bps: 1050, label: "10,5%" },
  { bps: 2100, label: "21%" },
  { bps: 2700, label: "27%" },
];

export const PROVINCES = [
  "Entre Ríos",
  "Santa Fe",
  "Buenos Aires",
  "CABA",
  "Córdoba",
  "Corrientes",
  "Misiones",
  "Chaco",
  "Mendoza",
  "Tucumán",
  "Salta",
  "Neuquén",
  "Río Negro",
  "Chubut",
  "Otra",
];

export function taxConditionLabel(value: string | null | undefined): string {
  return TAX_CONDITION_LABELS.find((item) => item.value === value)?.label ?? "Sin definir";
}

export function rateLabel(bps: number): string {
  const known = IVA_RATES.find((item) => item.bps === bps);
  if (known) return known.label;
  return `${(bps / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}
