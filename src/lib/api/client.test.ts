import { afterEach, expect, it, vi } from "vitest";
import { apiGet, clearSessionCache } from "./client";

afterEach(() => { clearSessionCache(); vi.unstubAllGlobals(); });

it("comparte lecturas concurrentes pero nunca mezcla respuestas entre sesiones o empresas", async () => {
  const finish: ((response: Response) => void)[] = [];
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish.push(resolve); }));
  vi.stubGlobal("fetch", fetchMock);
  const old = apiGet("/api/catalogos");
  const same = apiGet("/api/catalogos");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  clearSessionCache();
  const current = apiGet("/api/catalogos");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  finish[1](Response.json({ ok: true, data: { company: "new" } }));
  finish[0](Response.json({ ok: true, data: { company: "old" } }));
  expect(await current).toEqual({ company: "new" });
  expect(await old).toEqual({ company: "old" });
  expect(await same).toEqual({ company: "old" });
});
