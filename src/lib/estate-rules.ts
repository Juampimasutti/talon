/** Importes en centavos y tasas en puntos básicos; redondeo comercial. */
export function applyRate(cents: number, basisPoints: number): number {
  return Number(
    (BigInt(cents) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000),
  );
}
export function leasePenalty(
  rentCents: number,
  dailyBps: number,
  dueOn: string,
  asOf: string,
  graceDays: number,
) {
  const days = Math.max(
    0,
    Math.floor((Date.parse(asOf) - Date.parse(dueOn)) / 86400000) - graceDays,
  );
  return applyRate(rentCents, dailyBps * days);
}
export function settlementAmounts(
  rentCollected: number,
  extrasCollected: number,
  commissionBps: number,
  vatBps: number,
  expenses: number,
) {
  const commission = applyRate(rentCollected, commissionBps);
  const totalCommission = commission + applyRate(commission, vatBps);
  return {
    commission,
    totalCommission,
    payable: rentCollected + extrasCollected - totalCommission - expenses,
  };
}
export function addMonths(date: string, count: number) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + count);
  const end = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(day, end));
  return value.toISOString().slice(0, 10);
}
