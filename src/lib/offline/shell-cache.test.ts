import { describe, expect, it } from "vitest";
import { canReadEstacion, estacionPrecachePaths, shouldCacheDocument, shouldRetryStatus } from "./shell-cache";

describe("caché del shell", () => {
  it("no guarda el HTML del overlay de desarrollo", () => {
    expect(shouldCacheDocument("<html><body><div id=\"app\"></div></body></html>")).toBe(true);
    expect(shouldCacheDocument('<html><body><nextjs-portal style="--ols-scale: 1;"></nextjs-portal></body></html>')).toBe(false);
    expect(shouldCacheDocument('<html data-nextjs-dev-overlay="true"></html>')).toBe(false);
  });

  it("no reintenta un 403 y sí un 503", () => {
    expect(shouldRetryStatus(403)).toBe(false);
    expect(shouldRetryStatus(404)).toBe(false);
    expect(shouldRetryStatus(401)).toBe(false);
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(200)).toBe(true);
  });

  it("laura en la distribuidora no precarga la estación", () => {
    const laura = { company: { modules: ["ventas", "caja"] }, permissions: ["ventas.ver", "caja.ver"] };
    expect(canReadEstacion(laura)).toBe(false);
    expect(estacionPrecachePaths(laura)).toEqual([]);
    const luciana = { company: { modules: ["estacion"] }, permissions: ["estacion.ver", "estacion.crear"] };
    expect(estacionPrecachePaths(luciana)).toEqual(["/api/estacion", "/api/estacion/flota", "/api/estacion/flota-clientes"]);
  });
});
