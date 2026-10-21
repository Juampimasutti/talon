import { describe, expect, it } from "vitest";
import { measureCertificate } from "./construction-rules";
const settings = {
  indexBaseMillion: 100_000_000,
  indexPeriodMillion: 120_000_000,
  advanceCents: 10_000,
  recoveredAdvanceCents: 0,
  repairBps: 500,
  vatBps: 2100,
};
describe("certificados por cantidades pactados", () => {
  it("aplica CAC, anticipo proporcional, reparo e IVA en el orden solicitado", () => {
    const result = measureCertificate(
      [
        {
          id: "a",
          quantityMilli: 10000,
          unitPriceCents: 10000,
          global: false,
          previousCents: 0,
          cumulativeQuantityMilli: 2000,
        },
      ],
      settings,
    );
    expect(result).toMatchObject({
      periodBaseCents: 20000,
      adjustmentCents: 4000,
      advanceReturnedCents: 2000,
      repairCents: 1200,
      taxBaseCents: 22000,
      vatCents: 4620,
      totalCents: 26620,
      progressBps: 2000,
    });
  });
  it("resta importes ya certificados y usa avance porcentual sólo en ítems globales", () => {
    const result = measureCertificate(
      [
        {
          id: "a",
          quantityMilli: 10000,
          unitPriceCents: 10000,
          global: false,
          previousCents: 20000,
          cumulativeQuantityMilli: 3000,
        },
        {
          id: "global",
          quantityMilli: 1000,
          unitPriceCents: 10000,
          global: true,
          previousCents: 2500,
          cumulativeBps: 5000,
        },
      ],
      { ...settings, advanceCents: 0 },
    );
    expect(result.periodBaseCents).toBe(12500);
    expect(result.lines[1].periodCents).toBe(2500);
  });
  it("rechaza exceso y retroceso sin cambiar el presupuesto", () => {
    const item = {
      id: "a",
      quantityMilli: 1000,
      unitPriceCents: 10000,
      global: false,
      previousCents: 5000,
    };
    expect(() =>
      measureCertificate(
        [{ ...item, cumulativeQuantityMilli: 1001 }],
        settings,
      ),
    ).toThrow("100%");
    expect(() =>
      measureCertificate([{ ...item, cumulativeQuantityMilli: 400 }], settings),
    ).toThrow("ya certificado");
  });
  it("el último certificado agota el anticipo sin devolverlo dos veces", () => {
    const result = measureCertificate(
      [
        {
          id: "a",
          quantityMilli: 10000,
          unitPriceCents: 10000,
          global: false,
          previousCents: 90000,
          cumulativeQuantityMilli: 10000,
        },
      ],
      { ...settings, recoveredAdvanceCents: 9000 },
    );
    expect(result.advanceReturnedCents).toBe(1000);
    expect(result.progressBps).toBe(10000);
  });
  it("anticipo y certificados completan el neto y el IVA de la obra sin volver a facturar el reparo", () => {
    let previousCents = 0,
      recoveredAdvanceCents = 0;
    let invoicedNet = 100000,
      invoicedVat = 21000,
      retained = 0;
    for (const cumulativeQuantityMilli of [5000, 10000]) {
      const result = measureCertificate(
        [
          {
            id: "obra",
            quantityMilli: 10000,
            unitPriceCents: 50000,
            global: false,
            previousCents,
            cumulativeQuantityMilli,
          },
        ],
        {
          ...settings,
          indexPeriodMillion: settings.indexBaseMillion,
          advanceCents: 100000,
          recoveredAdvanceCents,
        },
      );
      previousCents = result.cumulativeBaseCents;
      recoveredAdvanceCents += result.advanceReturnedCents;
      invoicedNet += result.taxBaseCents;
      invoicedVat += result.vatCents;
      retained += result.repairCents;
    }
    expect(invoicedNet).toBe(500000);
    expect(invoicedVat).toBe(105000);
    expect(recoveredAdvanceCents).toBe(100000);
    expect(retained).toBe(25000);
  });
});
