import { describe, expect, it } from "vitest";
import { acceptToast } from "./toast-once";

describe("avisos", () => {
  it("no repite el mismo mensaje dentro de la ventana", () => {
    const first = acceptToast("Esa caja está cerrada. Abrila para cargar el saldo inicial.", 1_000, null);
    expect(first.accept).toBe(true);
    const again = acceptToast("Esa caja está cerrada. Abrila para cargar el saldo inicial.", 1_400, first.next);
    expect(again.accept).toBe(false);
    const later = acceptToast("Esa caja está cerrada. Abrila para cargar el saldo inicial.", 3_000, first.next);
    expect(later.accept).toBe(true);
    const other = acceptToast("Saldo inicial anotado", 1_200, first.next);
    expect(other.accept).toBe(true);
  });
});
