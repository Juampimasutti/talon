import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), selectedCompany: "company-a" as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => {
    const value = name === "talon_session" ? "test-session" : mocks.selectedCompany;
    return value ? { value } : undefined;
  } }),
}));
vi.mock("../db/client", () => ({ getDb: () => ({ execute: mocks.execute }) }));

const ctx = { user: { id: "user", name: "Laura", email: "demo" }, memberships: [
  { companyId: "company-a", roleId: "role-a", companyName: "Comercio", permissions: ["ventas.crear"] },
  { companyId: "company-b", roleId: "role-b", companyName: "Estación", permissions: ["estacion.crear"] },
] };

beforeEach(() => { vi.resetModules(); mocks.execute.mockReset(); mocks.selectedCompany = "company-a"; });

describe("selección de empresa por sesión", () => {
  it("conserva empresa y permisos de cada sesión aunque el usuario cambie su empresa guardada", async () => {
    mocks.execute.mockResolvedValueOnce([{ ctx }]).mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: false }]).mockResolvedValueOnce([{ ctx }]);
    const { getAuth } = await import("./session");
    const first = await getAuth();
    expect(first?.company.companyId).toBe("company-a");
    expect([...first!.permissions]).toEqual(["ventas.crear"]);
    mocks.selectedCompany = "company-b";
    const second = await getAuth();
    expect(second?.company.companyId).toBe("company-b");
    expect([...second!.permissions]).toEqual(["estacion.crear"]);
    // No auth_home_company query is needed when the session has a selection.
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("mantiene la empresa guardada para sesiones antiguas sin cookie de selección", async () => {
    mocks.selectedCompany = undefined;
    mocks.execute.mockResolvedValueOnce([{ ctx }]).mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: false }]).mockResolvedValueOnce([{ company_id: "company-b" }]).mockResolvedValueOnce([{ ctx }]);
    const { getAuth } = await import("./session");
    expect((await getAuth())?.company.companyId).toBe("company-b");
  });
});
