import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieBase } from "./session";

describe("cookie de sesión local", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("permite iniciar sesión por HTTP dentro de la red local", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TALON_COOKIE_SECURE", "");
    expect(cookieBase().secure).toBe(false);
  });

  it("se puede restringir a HTTPS al publicar el sistema", () => {
    vi.stubEnv("TALON_COOKIE_SECURE", "1");
    expect(cookieBase().secure).toBe(true);
  });
});
