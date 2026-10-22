// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { empresaIdFromPath, rememberEmpresa, rememberedEmpresa } from "./seleccion";

describe("selección de empresa impositiva", () => {
  it("obtiene la empresa de una ruta fiscal", () => {
    expect(empresaIdFromPath("/impuestos/empresas/11111111-1111-4111-8111-111111111111/ventas")).toBe("11111111-1111-4111-8111-111111111111");
    expect(empresaIdFromPath("/impuestos")).toBeNull();
  });

  it("recuerda la selección para navegar entre secciones", () => {
    rememberEmpresa("11111111-1111-4111-8111-111111111111");
    expect(rememberedEmpresa()).toBe("11111111-1111-4111-8111-111111111111");
  });
});
