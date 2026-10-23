export type EsquemaIva = "iva_simple" | "f2002_lid";
export type FlujoPeriodo = EsquemaIva | "lid_exento" | "no_corresponde";

export function esquemaParaPeriodo(config: { esquemaIva?: EsquemaIva; ivaSimpleDesde?: string | null }, periodo: string, condicionIva: string): FlujoPeriodo {
  if (condicionIva === "exento") return "lid_exento";
  if (condicionIva !== "ri") return "no_corresponde";
  const desde = config.ivaSimpleDesde || "202511";
  if (periodo < desde) return "f2002_lid";
  return config.esquemaIva ?? "iva_simple";
}

export function avisoEsquema(periodo: string, flujo: FlujoPeriodo): string | null {
  return periodo >= "202511" && flujo === "f2002_lid"
    ? "Desde noviembre de 2025 ARCA prevé IVA Simple (F.2051) para responsables inscriptos. Revisá el esquema elegido antes de presentar."
    : null;
}
