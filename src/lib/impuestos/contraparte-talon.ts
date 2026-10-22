/**
 * Datos para crear un cliente/proveedor de Talón desde un comprobante importado.
 * La condición frente al IVA se deduce de la letra del comprobante (Mis Comprobantes
 * no trae la condición del receptor). Cuando la letra no alcanza para saberla con
 * certeza, se elige la más probable y se marca para revisar.
 */
export type TaxCondition = "ri" | "monotributo" | "cf" | "exento";

export function condicionDesdeComprobante(input: { libro: "ventas" | "compras"; letra: string | null; docTipo: number }): { taxCondition: TaxCondition; revisar: boolean } {
  const letra = (input.letra ?? "").toUpperCase();
  if (input.libro === "compras") {
    // Quien emite A, B o M es Responsable Inscripto; C lo emiten monotributistas (o exentos).
    if (letra === "A" || letra === "B" || letra === "M") return { taxCondition: "ri", revisar: false };
    if (letra === "C") return { taxCondition: "monotributo", revisar: true };
    return { taxCondition: "ri", revisar: true };
  }
  // Ventas: la letra que emitimos depende de la condición del receptor.
  if (letra === "A" || letra === "M") return { taxCondition: "ri", revisar: false };
  if (input.docTipo !== 80 && input.docTipo !== 86) return { taxCondition: "cf", revisar: false };
  if (letra === "B") return { taxCondition: "monotributo", revisar: true };
  return { taxCondition: "cf", revisar: true };
}

/** Tipo y número de documento como los guarda Talón (CUIT con guiones). */
export function documentoTalon(docTipo: number, docNro: string): { docType: "CUIT" | "DNI" | "OTRO"; cuit: string } {
  const digits = docNro.replace(/\D/g, "");
  if (docTipo === 80 && digits.length === 11) return { docType: "CUIT", cuit: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` };
  if (docTipo === 96) return { docType: "DNI", cuit: digits };
  return { docType: "OTRO", cuit: digits };
}
