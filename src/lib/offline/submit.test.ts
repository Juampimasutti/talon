import { afterEach, describe, expect, it, vi } from "vitest";
import { holdSyncUntilOnline, mayPostSync, releaseSyncHold, submitQueued, watchSync } from "./submit";

vi.mock("./idb", () => ({
  putOp: vi.fn(async () => {}),
  putKv: vi.fn(async () => {}),
  getKv: vi.fn(async () => null),
  listOps: vi.fn(async () => []),
  listConflicts: vi.fn(async () => []),
  deleteOp: vi.fn(async () => {}),
  deleteConflict: vi.fn(async () => {}),
  putConflict: vi.fn(async () => {}),
}));

type Listener = () => void;

function installBrowser() {
  const listeners = new Map<string, Set<Listener>>();
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  let next = 0;
  const nav = { onLine: true };
  const win = {
    addEventListener(type: string, fn: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    setTimeout(fn: () => void) {
      next += 1;
      timeouts.set(next, fn);
      return next;
    },
    clearTimeout(id: number) {
      timeouts.delete(id);
    },
    setInterval(fn: () => void) {
      next += 1;
      intervals.set(next, fn);
      return next;
    },
    clearInterval(id: number) {
      intervals.delete(id);
    },
    runIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    dispatchEvent() {},
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    runDue() {
      const due = [...timeouts.entries()];
      timeouts.clear();
      for (const [, fn] of due) fn();
    },
    pending() {
      return timeouts.size;
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
  return { win, nav };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

afterEach(() => {
  releaseSyncHold();
  vi.unstubAllGlobals();
});

describe("sync offline", () => {
  it("no postea si navigator.onLine es false o el backoff está en pausa", () => {
    expect(mayPostSync(false, false)).toBe(false);
    expect(mayPostSync(true, true)).toBe(false);
    expect(mayPostSync(true, false)).toBe(true);
  });

  it("no agenda /api/sync mientras el navegador figura offline", () => {
    const { win, nav } = installBrowser();
    nav.onLine = false;
    const flush = vi.fn(async () => "ok" as const);
    const stop = watchSync(flush);
    expect(win.pending()).toBe(0);
    win.fire("talon-outbox");
    win.fire("focus");
    expect(flush).not.toHaveBeenCalled();
    stop();
  });

  it("el evento online corta el backoff y sincroniza en el acto", async () => {
    const { win, nav } = installBrowser();
    const flush = vi.fn(async () => "retry" as const);
    const stop = watchSync(flush);
    expect(win.pending()).toBe(1);
    win.runDue();
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(win.pending()).toBe(1);
    nav.onLine = false;
    win.fire("offline");
    expect(win.pending()).toBe(0);
    win.runDue();
    expect(flush).toHaveBeenCalledTimes(1);
    nav.onLine = true;
    win.fire("online");
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
  });

  it("después de un fallo no reintenta hasta online", () => {
    const { win } = installBrowser();
    holdSyncUntilOnline();
    const flush = vi.fn(async () => "retry" as const);
    const stop = watchSync(flush);
    expect(win.pending()).toBe(0);
    win.fire("talon-outbox");
    expect(flush).not.toHaveBeenCalled();
    win.fire("online");
    expect(flush).toHaveBeenCalledTimes(1);
    stop();
  });

  it("encola el vale sin fetch si navigator.onLine es false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      dispatchEvent() {},
      localStorage: { setItem() {}, getItem() { return null; } },
      sessionStorage: { setItem() {}, getItem() { return null; } },
    });
    releaseSyncHold();
    const result = await submitQueued("vale", "/api/estacion/flota/vale", { liters: 2, partyName: "ACME" });
    expect(result.queued).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si /api/health responde, sincroniza sin esperar el evento online", async () => {
    const { win } = installBrowser();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    holdSyncUntilOnline();
    const flush = vi.fn(async () => "ok" as const);
    const stop = watchSync(flush);
    win.fire("focus");
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);
    stop();
  });
});
