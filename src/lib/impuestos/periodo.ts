import { z } from "zod";

export const periodoSchema = z.string().regex(/^\d{6}$/, "Período inválido").refine((value) => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}, "Período inválido");

export function periodoVisible(periodo: string) {
  return `${periodo.slice(4)}/${periodo.slice(0, 4)}`;
}

export function mensajePeriodoCerrado(periodo: string) {
  return `El período ${periodoVisible(periodo)} está confirmado. Reabrilo para importar.`;
}

export function esErrorPeriodoCerrado(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === "55000" || value?.cause?.code === "55000";
}

export function reglaFechaImportada(libro: "ventas" | "compras", fechaIso: string, periodo: string): { rechazo?: string; aviso?: string } {
  const comprobante = fechaIso.slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(comprobante)) return {};
  if (libro === "ventas" && comprobante !== periodo) return { rechazo: "Fecha fuera del período" };
  if (libro === "compras" && comprobante > periodo) return { rechazo: "Fecha fuera del período" };
  if (libro === "compras" && comprobante < periodo) return { aviso: "Comprobante de compra de un período anterior: revisar cómputo diferido" };
  return {};
}
