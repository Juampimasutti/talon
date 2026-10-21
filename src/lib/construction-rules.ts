import { applyRate } from "./estate-rules";

export type MeasuredItem = {
  id: string;
  quantityMilli: number;
  unitPriceCents: number;
  global: boolean;
  previousCents: number;
  cumulativeQuantityMilli?: number;
  cumulativeBps?: number;
};
function ratio(amount: number, numerator: number, denominator: number) {
  if (denominator <= 0) throw new Error("El divisor debe ser positivo");
  const result = Number(
    (BigInt(amount) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) /
      BigInt(denominator),
  );
  if (!Number.isSafeInteger(result))
    throw new Error("El importe excede la precisión permitida");
  return result;
}
/** Cantidades acumuladas por ítem; el progreso total jamás determina la factura. */
export function measureCertificate(
  items: MeasuredItem[],
  settings: {
    indexBaseMillion: number;
    indexPeriodMillion: number;
    advanceCents: number;
    recoveredAdvanceCents: number;
    repairBps: number;
    vatBps: number;
  },
) {
  const lines = items.map((item) => {
    const budget = ratio(item.unitPriceCents, item.quantityMilli, 1000);
    const cumulative = item.global
      ? applyRate(budget, item.cumulativeBps ?? 0)
      : ratio(item.unitPriceCents, item.cumulativeQuantityMilli ?? 0, 1000);
    if (
      item.global
        ? (item.cumulativeBps ?? 0) < 0 || (item.cumulativeBps ?? 0) > 10000
        : (item.cumulativeQuantityMilli ?? 0) < 0 ||
          (item.cumulativeQuantityMilli ?? 0) > item.quantityMilli
    )
      throw new Error(
        "No se puede superar el 100% de un ítem; creá un adicional o ampliación",
      );
    if (cumulative < item.previousCents)
      throw new Error(
        "La cantidad acumulada no puede ser menor a lo ya certificado",
      );
    return {
      id: item.id,
      budgetCents: budget,
      cumulativeCents: cumulative,
      periodCents: cumulative - item.previousCents,
    };
  });
  const budgetCents = lines.reduce((sum, line) => sum + line.budgetCents, 0);
  if (!Number.isSafeInteger(budgetCents) || budgetCents > 1e12)
    throw new Error("El presupuesto supera el máximo permitido");
  const cumulativeBaseCents = lines.reduce(
    (sum, line) => sum + line.cumulativeCents,
    0,
  );
  const periodBaseCents = lines.reduce(
    (sum, line) => sum + line.periodCents,
    0,
  );
  if (!budgetCents || periodBaseCents <= 0)
    throw new Error("No hay nuevas cantidades para certificar");
  const adjusted = ratio(
    periodBaseCents,
    settings.indexPeriodMillion,
    settings.indexBaseMillion,
  );
  const adjustmentCents = adjusted - periodBaseCents;
  const advanceReturnedCents = Math.max(
    0,
    Math.min(
      settings.advanceCents - settings.recoveredAdvanceCents,
      ratio(settings.advanceCents, cumulativeBaseCents, budgetCents) -
        settings.recoveredAdvanceCents,
    ),
  );
  const repairCents = applyRate(adjusted, settings.repairBps);
  const taxBaseCents = adjusted - advanceReturnedCents;
  if (taxBaseCents <= 0)
    throw new Error(
      "El anticipo deja un neto no positivo; revisá las condiciones de la obra",
    );
  const vatCents = applyRate(taxBaseCents, settings.vatBps);
  return {
    lines,
    budgetCents,
    cumulativeBaseCents,
    periodBaseCents,
    adjustmentCents,
    advanceReturnedCents,
    repairCents,
    taxBaseCents,
    vatCents,
    totalCents: taxBaseCents + vatCents,
    progressBps: ratio(cumulativeBaseCents, 10000, budgetCents),
  };
}
