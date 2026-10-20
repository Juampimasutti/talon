import { describe, expect, it } from "vitest";
import { ageLedger } from "./aging";

describe("antigüedad de saldos", () => {
  it("netea cobros y notas de crédito contra lo más viejo, igual que la cuenta corriente", () => {
    const rows = ageLedger(
      [
        { party: "Litoral", partyKind: "cliente", occurredOn: "2026-06-01", debitCents: 10_000, creditCents: 0 },
        { party: "Litoral", partyKind: "cliente", occurredOn: "2026-07-01", creditCents: 4_000, debitCents: 0 },
        { party: "Litoral", partyKind: "cliente", occurredOn: "2026-10-10", debitCents: 2_000, creditCents: 0 },
        { party: "YPF", partyKind: "proveedor", occurredOn: "2026-09-01", debitCents: 0, creditCents: 5_000 },
        { party: "YPF", partyKind: "proveedor", occurredOn: "2026-09-15", debitCents: 5_000, creditCents: 0 },
      ],
      "2026-10-20",
    );
    expect(rows).toEqual([
      { party: "Litoral", partyKind: "cliente", bucket: "0 a 30", cents: 2_000 },
      { party: "Litoral", partyKind: "cliente", bucket: "más de 90", cents: 6_000 },
    ]);
  });

  it("el cobro que sobra queda como saldo a favor", () => {
    const rows = ageLedger(
      [
        { party: "Norte", partyKind: "cliente", occurredOn: "2026-10-01", debitCents: 1_000, creditCents: 0 },
        { party: "Norte", partyKind: "cliente", occurredOn: "2026-10-02", debitCents: 0, creditCents: 2_500 },
      ],
      "2026-10-20",
    );
    expect(rows).toEqual([{ party: "Norte", partyKind: "cliente", bucket: "saldos a favor", cents: -1_500 }]);
  });
});
