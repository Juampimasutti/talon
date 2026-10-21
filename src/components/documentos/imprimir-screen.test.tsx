// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImprimirScreen } from "./imprimir-screen";

const state = vi.hoisted(() => ({
  finish: null as ((svg: string) => void) | null,
  data: { id: "d1", kind: "venta", letter: "B", pointOfSale: 1, number: 1, issuedOn: "2026-10-20", partyName: "Demo", partyCuit: null, partyTaxCondition: "cf", paymentMethod: "contado", notes: null, netTaxedCents: 100, vatCents: 21, exemptCents: 0, netUntaxedCents: 0, perceptionsCents: 0, otherTaxesCents: 0, totalCents: 121, cae: "test-only", caeDue: null, caeStatus: "autorizado", typeCode: "FAC", lines: [] },
  company: { legalName: "Demo", cuit: "20304050607", city: "Paraná", province: "Entre Ríos", pointOfSale: 1 },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "d1" }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data, isLoading: false }) }));
vi.mock("@/components/use-me", () => ({ useMe: () => ({ data: { company: state.company }, isLoading: false }) }));
vi.mock("@/lib/fiscal/arca", () => ({ afipCodeFor: () => 6, afipQrUrl: () => "https://example.test/qr" }));
vi.mock("qrcode", () => ({ default: { toString: () => new Promise<string>((resolve) => { state.finish = resolve; }) } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("espera la generación asíncrona del QR antes de abrir la impresión", async () => {
  vi.useFakeTimers();
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const view = render(<ImprimirScreen kind="venta" />);
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(print).not.toHaveBeenCalled();
  expect(state.finish).not.toBeNull();
  await act(async () => { state.finish!("<svg><title>test QR</title></svg>"); });
  expect(view.getByLabelText("QR del comprobante")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(250); });
  expect(print).toHaveBeenCalledTimes(1);
});
