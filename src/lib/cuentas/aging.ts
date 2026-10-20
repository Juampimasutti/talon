export type LedgerRow = {
  party: string;
  partyKind: "cliente" | "proveedor";
  occurredOn: string;
  debitCents: number;
  creditCents: number;
};

export type AgedBalance = {
  party: string;
  partyKind: "cliente" | "proveedor";
  bucket: string;
  cents: number;
};

const BUCKETS = [
  { label: "0 a 30", max: 30 },
  { label: "31 a 60", max: 60 },
  { label: "61 a 90", max: 90 },
  { label: "más de 90", max: Number.POSITIVE_INFINITY },
] as const;

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Antigüedad con la misma base que la cuenta corriente.
 * Cliente: facturas y notas de débito (debe) menos notas de crédito, recibos y cobros (haber), FIFO.
 * Proveedor: facturas de compra (haber) menos notas de crédito y pagos (debe), FIFO.
 * Los remitos no entran: no mueven la cuenta corriente.
 */
export function ageLedger(rows: LedgerRow[], today: string): AgedBalance[] {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const key = `${row.partyKind}\0${row.party}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const aged: AgedBalance[] = [];
  for (const list of groups.values()) {
    const kind = list[0]?.partyKind;
    if (!kind) continue;
    const sorted = [...list].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    const open: { occurredOn: string; left: number }[] = [];
    for (const row of sorted) {
      const charge = kind === "cliente" ? row.debitCents : row.creditCents;
      const payment = kind === "cliente" ? row.creditCents : row.debitCents;
      if (charge > 0) {
        let left = charge;
        for (const item of open) {
          if (left <= 0) break;
          if (item.left >= 0) continue;
          const take = Math.min(-item.left, left);
          item.left += take;
          left -= take;
        }
        if (left > 0) open.push({ occurredOn: row.occurredOn, left });
      }
      let rest = payment;
      for (const item of open) {
        if (rest <= 0) break;
        if (item.left <= 0) continue;
        const take = Math.min(item.left, rest);
        item.left -= take;
        rest -= take;
      }
      if (rest > 0) open.push({ occurredOn: row.occurredOn, left: -rest });
    }
    const buckets = new Map<string, number>();
    for (const item of open) {
      if (item.left === 0) continue;
      if (item.left < 0) {
        buckets.set("saldos a favor", (buckets.get("saldos a favor") ?? 0) + item.left);
        continue;
      }
      const age = daysBetween(item.occurredOn, today);
      const bucket = BUCKETS.find((candidate) => age <= candidate.max) ?? BUCKETS[3];
      buckets.set(bucket.label, (buckets.get(bucket.label) ?? 0) + item.left);
    }
    for (const [bucket, cents] of buckets) {
      aged.push({ party: list[0]?.party ?? "", partyKind: kind, bucket, cents });
    }
  }
  return aged.sort((a, b) => a.party.localeCompare(b.party, "es") || a.bucket.localeCompare(b.bucket, "es"));
}
