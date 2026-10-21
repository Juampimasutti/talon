import { ApiError, apiGet, loadSession } from "@/lib/api/client";
import { estacionPrecachePaths, shouldCacheDocument, type SessionLike } from "./shell-cache";
import { opsForScope, scopeKey, sortQueue, provisionalReceipt, reuseKey, type OpKind, type QueuedOp } from "./engine";
import { deleteConflict, deleteOp, getKv, listConflicts, listOps, putConflict, putKv, putOp } from "./idb";

type SubmitResult = { queued: true; key: string; payload: Record<string, unknown> } | { queued: false; data: unknown };

let last: { fingerprint: string; key: string; at: number } | null = null;

let currentScope: string | null = null;

export function setOfflineScope(userId: string | null, companyId: string | null) {
  const next = userId && companyId ? scopeKey(userId, companyId) : null;
  if (next === currentScope) return;
  currentScope = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("talon-outbox"));
}

export function offlineScope() {
  return currentScope;
}

function rememberKey(kind: OpKind, payload: Record<string, unknown>) {
  const reused = reuseKey(`${currentScope ?? ""}:${kind}`, payload, Date.now(), 10_000, last);
  if (reused) {
    last = reused;
    return reused.key;
  }
  const key = crypto.randomUUID();
  last = { fingerprint: `${currentScope ?? ""}:${kind}:${JSON.stringify(payload)}`, key, at: Date.now() };
  return key;
}

export function reserveQueueKey(kind: OpKind, payload: Record<string, unknown>) {
  return rememberKey(kind, payload);
}

export function isNetworkError(error: unknown) {
  return error instanceof TypeError;
}

const submitInflight = new Map<string, Promise<SubmitResult>>();

export async function submitQueued(kind: OpKind, path: string, payload: Record<string, unknown>): Promise<SubmitResult> {
  const key = rememberKey(kind, payload);
  const fingerprint = last?.fingerprint ?? key;
  const pending = submitInflight.get(fingerprint);
  if (pending) return pending;
  const run = submitQueuedNow(kind, path, payload, key).finally(() => submitInflight.delete(fingerprint));
  submitInflight.set(fingerprint, run);
  return run;
}

function offlineNow() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Después de un fallo no se llama a /api/sync hasta que /api/health responda o vuelva el evento online. */
let pauseUntilOnline = false;

export function mayPostSync(onLine: boolean, paused: boolean): boolean {
  return onLine && !paused;
}

export function holdSyncUntilOnline() {
  pauseUntilOnline = true;
}

export function releaseSyncHold() {
  pauseUntilOnline = false;
}

async function submitQueuedNow(kind: OpKind, path: string, payload: Record<string, unknown>, key: string): Promise<SubmitResult> {
  if (!mayPostSync(!offlineNow(), pauseUntilOnline)) {
    markReachable(false);
    return queueLocal(kind, path, payload, key);
  }
  try {
      if (offlineNow()) {
        holdSyncUntilOnline();
        markReachable(false);
        return queueLocal(kind, path, payload, key);
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        holdSyncUntilOnline();
        markReachable(false);
        return queueLocal(kind, path, payload, key);
      }
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operations: [{ key, kind, payload, createdAt: new Date().toISOString() }] }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(failed?.error ?? "No se pudo guardar", response.status);
      }
      const body = (await response.json()) as { data?: { results?: { status: string; reason?: string; message?: string; body?: unknown }[] } };
      const result = body.data?.results?.[0];
      const issued = result?.body && typeof result.body === "object" && "documentId" in result.body && Boolean((result.body as { documentId?: string | null }).documentId);
      if ((result?.status === "conflict" || result?.status === "error") && !issued) throw new ApiError(result.reason ?? result.message ?? "No se pudo guardar", 409);
      markReachable(true);
      return { queued: false, data: result?.body ?? result };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      holdSyncUntilOnline();
      markReachable(false);
    }
  return queueLocal(kind, path, payload, key);
}

async function queueLocal(kind: OpKind, path: string, payload: Record<string, unknown>, key: string): Promise<SubmitResult> {
  void path;
  const op: QueuedOp = { key, kind, payload, createdAt: new Date().toISOString(), owner: currentScope ?? undefined };
  await putOp(op);
  if (kind === "comprobante" || kind === "vale" || kind === "reparto.entrega") {
    const receipt = provisionalReceipt({
      localNumber: `PROV-${key.slice(0, 4).toUpperCase()}`,
      partyName: String(payload.partyName ?? "Consumidor final"),
      issuedOn: String(payload.issuedOn ?? new Date().toISOString().slice(0, 10)),
      lines: Array.isArray(payload.lines) ? (payload.lines as { description: string; quantity: number; totalCents: number }[]) : [],
      totalCents: Number(payload.clientTotalCents ?? 0),
    });
    rememberReceipt(receipt);
    await putKv("last-receipt", receipt);
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("talon-last-receipt", JSON.stringify(receipt));
    window.dispatchEvent(new CustomEvent("talon-receipt", { detail: receipt }));
  }
  window.dispatchEvent(new Event("talon-outbox"));
  return { queued: true, key, payload };
}

export function rememberReceipt(receipt: ReturnType<typeof provisionalReceipt>) {
  const json = JSON.stringify(receipt);
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem("talon-last-receipt", json);
  if (typeof localStorage !== "undefined") localStorage.setItem("talon-last-receipt", json);
}

export function readReceipt(): ReturnType<typeof provisionalReceipt> | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("talon-last-receipt") || sessionStorage.getItem("talon-last-receipt");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReturnType<typeof provisionalReceipt>;
    if (parsed?.fiscal !== "provisorio") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function printProvisional(receipt: ReturnType<typeof provisionalReceipt>) {
  rememberReceipt(receipt);
}

export const SYNC_POLL_MS = 20_000;
export const SYNC_BACKOFF_CAP_MS = 20_000;
export const HEALTH_POLL_MS = 5_000;
export const SHELL_CACHE = "talon-shell-v4";

const precacheBlocked = new Set<string>();
let precacheFlight: Promise<void> | null = null;

/** Guarda chunks ya pedidos y, si hay permiso, los datos de la estación. No guarda HTML del overlay. */
export function precacheShell(session: SessionLike | null = null) {
  // Development chunks and the production offline shell are different artifacts.
  if (process.env.NODE_ENV !== "production") return Promise.resolve();
  if (typeof window === "undefined" || !("caches" in window)) return Promise.resolve();
  if (navigator.onLine === false) return Promise.resolve();
  if (precacheFlight) return precacheFlight;
  precacheFlight = runPrecache(session).finally(() => {
    precacheFlight = null;
  });
  return precacheFlight;
}

async function runPrecache(session: SessionLike | null) {
  const cache = await caches.open(SHELL_CACHE);
  const urls = new Set<string>(["/api/auth/me", "/api/catalogos", "/api/sync/referencia", "/shell-assets.json"]);
  for (const path of estacionPrecachePaths(session)) urls.add(path);
  for (const script of document.scripts) {
    if (!script.src) continue;
    const url = new URL(script.src, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.pathname + url.search);
  }
  for (const link of document.querySelectorAll("link[href]")) {
    const href = (link as HTMLLinkElement).href;
    if (!href) continue;
    const url = new URL(href, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.pathname + url.search);
  }
  for (const entry of performance.getEntriesByType("resource")) {
    const url = new URL(entry.name, location.origin);
    if (url.origin !== location.origin) continue;
    if (url.pathname.startsWith("/_next/static/")) urls.add(url.pathname + url.search);
  }
  await Promise.all([...urls].map(async (url) => {
    if (precacheBlocked.has(url)) return;
    try {
      if (url.startsWith("/_next/static/") && await cache.match(url)) return;
      const response = url.startsWith("/api/")
        ? Response.json({ ok: true, data: await apiGet(url) })
        : await fetch(url);
      if (response.status >= 400 && response.status < 500) {
        precacheBlocked.add(url);
        return;
      }
      if (!response.ok) return;
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("text/html")) {
        const copy = response.clone();
        const html = await response.text();
        if (!shouldCacheDocument(html)) return;
        await cache.put(url, copy);
        return;
      }
      await cache.put(url, response);
    } catch {
      /* un recurso que falle no impide cachear el resto */
    }
  }));
  (window as Window & { __talonPrecache?: boolean }).__talonPrecache = true;
}

/** Ping liviano. No abre sesión ni manda la cola. */
let healthFlight: Promise<boolean> | null = null;

export function pingHealth(): Promise<boolean> {
  if (healthFlight) return healthFlight;
  healthFlight = fetch("/api/health", { method: "GET", cache: "no-store", headers: { accept: "application/json" } })
    .then((response) => response.ok, () => false)
    .finally(() => { healthFlight = null; });
  return healthFlight;
}

/** La espera crece y se queda en el tope. No se abandona la cola. */
export function retryDelay(attempt: number): number {
  const step = Math.min(Math.max(0, attempt), 8);
  return Math.min(800 * 2 ** step, SYNC_BACKOFF_CAP_MS);
}

export type SyncItemResult = { key?: string; kind?: string; status: string; message?: string; reason?: string };

/** Un 4xx definitivo no se reintenta. 401, 408 y 429 sí, con la misma espera. */
export function batchRejected(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function partitionSyncResults<T extends { status: string }>(results: T[]): { done: T[]; failed: T[] } {
  const done: T[] = [];
  const failed: T[] = [];
  for (const result of results) {
    if (result.status === "error") failed.push(result);
    else if (result.status === "applied" || result.status === "duplicate" || result.status === "conflict") done.push(result);
  }
  return { done, failed };
}

/** Con cola vacía se espera el intervalo largo. Si queda algo o falló la red, vale el tope. */
export function nextSyncDelay(attempt: number, mode: "idle" | "ok" | "retry"): number {
  if (mode === "retry") return retryDelay(attempt);
  return SYNC_POLL_MS;
}

let reachable = true;
let syncing = false;

function publishReach() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("talon-reach"));
}

export function markReachable(value: boolean) {
  if (reachable === value) return;
  reachable = value;
  publishReach();
}

export function isReachable() {
  return reachable;
}

export function markSyncing(value: boolean) {
  if (syncing === value) return;
  syncing = value;
  publishReach();
}

export function isSyncing() {
  return syncing;
}

let probedAt = 0;
let probed: boolean | null = null;

export async function probeServer(): Promise<boolean> {
  if (offlineNow()) {
    markReachable(false);
    probed = false;
    probedAt = Date.now();
    return false;
  }
  if (probed !== null && Date.now() - probedAt < 8_000) return probed;
  try {
    await loadSession();
    markReachable(true);
    probed = true;
  } catch (error) {
    if (error instanceof TypeError) {
      markReachable(false);
      probed = false;
    } else {
      markReachable(true);
      probed = true;
    }
  }
  probedAt = Date.now();
  return Boolean(probed);
}

export async function pendingSaleCents(): Promise<number> {
  const ops = await ownOps();
  return ops.reduce((sum, op) => {
    const payload = op.payload;
    const amount = Number(payload.amountCents ?? payload.clientTotalCents ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function watchSync(flush: () => Promise<"idle" | "ok" | "retry">) {
  if (typeof window === "undefined") return () => {};
  let timer = 0;
  let stopped = false;
  let running = false;
  let queued = false;
  let attempt = 0;
  const kick = () => {
    if (stopped || running) {
      if (!stopped) queued = true;
      return;
    }
    running = true;
    void flush()
      .then((mode) => {
        running = false;
        if (stopped) return;
        if (pauseUntilOnline || offlineNow()) {
          window.clearTimeout(timer);
          queued = false;
          forceQueued = false;
          return;
        }
        if (forceQueued) {
          forceQueued = false;
          queued = false;
          attempt = 0;
          kick();
          return;
        }
        if (mode === "retry") attempt += 1;
        else attempt = 0;
        if (queued && mode !== "retry") {
          queued = false;
          kick();
          return;
        }
        queued = false;
        window.clearTimeout(timer);
        timer = window.setTimeout(kick, nextSyncDelay(attempt, mode));
      })
      .catch(() => {
        running = false;
        if (stopped) return;
        queued = false;
        forceQueued = false;
        attempt += 1;
        window.clearTimeout(timer);
        if (pauseUntilOnline || offlineNow()) return;
        timer = window.setTimeout(kick, nextSyncDelay(attempt, "retry"));
      });
  };
  let forceQueued = false;
  const kickSoon = (force: boolean) => {
    if (offlineNow() || (pauseUntilOnline && !force)) return;
    if (running) {
      if (force) forceQueued = true;
      else queued = true;
      return;
    }
    if (attempt > 0 && !force) return;
    if (force) attempt = 0;
    window.clearTimeout(timer);
    kick();
  };
  const soon = () => kickSoon(false);
  const probeSoon = () => {
    if (stopped || (!pauseUntilOnline && !offlineNow())) return;
    void pingHealth().then((up) => {
      if (!up || stopped) return;
      releaseSyncHold();
      markReachable(true);
      kickSoon(true);
    });
  };
  const onOnline = () => {
    releaseSyncHold();
    kickSoon(true);
  };
  const onOffline = () => {
    holdSyncUntilOnline();
    markReachable(false);
    window.clearTimeout(timer);
  };
  const onFocus = () => {
    if (pauseUntilOnline || offlineNow()) probeSoon();
    else soon();
  };
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    onFocus();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("focus", onFocus);
  window.addEventListener("visibilitychange", onVisible);
  window.addEventListener("talon-outbox", soon);
  const healthTimer = window.setInterval(probeSoon, HEALTH_POLL_MS);
  if (mayPostSync(!offlineNow(), pauseUntilOnline)) timer = window.setTimeout(kick, 0);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(healthTimer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("talon-outbox", soon);
  };
}

/** Listas que hay que refrescar cuando una operación offline ya quedó en el servidor. */
export function queryKeysAfterSync(results: { status: string; kind?: string }[]): string[] {
  const keys = new Set<string>();
  for (const result of results) {
    if (result.status !== "applied" && result.status !== "duplicate") continue;
    if (result.kind === "vale") keys.add("estacion-flota");
    else if (result.kind === "turno" || result.kind === "aforadores" || result.kind === "shop" || result.kind === "cobro") keys.add("estacion");
    else if (result.kind?.startsWith("reparto.")) keys.add("reparto");
    else if (result.kind === "comprobante") keys.add("documentos");
    else {
      keys.add("estacion-flota");
      keys.add("estacion");
      keys.add("reparto");
    }
  }
  return [...keys];
}

let flushFlight: Promise<"idle" | "ok" | "retry"> | null = null;

export function flushQueue(): Promise<"idle" | "ok" | "retry"> {
  if (flushFlight) return flushFlight;
  flushFlight = runFlush().finally(() => {
    flushFlight = null;
  });
  return flushFlight;
}

async function ownOps() {
  return sortQueue(opsForScope(await listOps(), currentScope));
}

async function runFlush(): Promise<"idle" | "ok" | "retry"> {
  const ops = await ownOps();
  if (!ops.length) return "idle";
  if (!mayPostSync(!offlineNow(), pauseUntilOnline) || offlineNow()) {
    markReachable(false);
    return "retry";
  }
  markSyncing(true);
  try {
    let response: Response;
    try {
      if (offlineNow()) {
        holdSyncUntilOnline();
        markReachable(false);
        return "retry";
      }
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operations: ops }),
      });
      markReachable(true);
    } catch {
      holdSyncUntilOnline();
      markReachable(false);
      return "retry";
    }
    if (batchRejected(response.status)) {
      const failed = (await response.json().catch(() => null)) as { error?: string } | null;
      const reason = failed?.error ?? "El servidor rechazó la sincronización";
      for (const op of ops) {
        await putConflict({ key: op.key, kind: op.kind, reason, at: new Date().toISOString(), payload: op.payload, owner: op.owner });
        await deleteOp(op.key);
      }
      window.dispatchEvent(new Event("talon-outbox"));
      return "ok";
    }
    if (!response.ok) throw new Error("No se pudo sincronizar");
    const body = (await response.json()) as { data?: { results?: SyncItemResult[] } };
    const results = body.data?.results ?? [];
    for (const result of results) {
      const op = ops.find((item) => item.key === result.key);
      if (result.status === "conflict" || result.status === "error") {
        await putConflict({
          key: result.key ?? "",
          kind: result.kind ?? op?.kind ?? "",
          reason: result.reason ?? result.message ?? "No se pudo sincronizar",
          at: new Date().toISOString(),
          payload: op?.payload,
          owner: op?.owner,
        });
      }
      if (result.status === "applied" || result.status === "duplicate" || result.status === "conflict" || result.status === "error") {
        if (result.key) await deleteOp(result.key);
      }
    }
    window.dispatchEvent(new Event("talon-outbox"));
    const keys = queryKeysAfterSync(results);
    if (keys.length) window.dispatchEvent(new CustomEvent("talon-synced", { detail: keys }));
    const left = (await ownOps()).length;
    if (left > 0) return "retry";
    return "ok";
  } finally {
    markSyncing(false);
  }
}

export async function pendingCount() {
  return (await ownOps()).length;
}

export async function pendingOperations() {
  return ownOps();
}

export async function pendingLocalIds(kind?: string): Promise<string[]> {
  const ops = await ownOps();
  return ops.filter((op) => !kind || op.kind === kind).map((op) => `local-${op.key}`);
}

export async function reviewItems() {
  return opsForScope(await listConflicts(), currentScope);
}

const referenceFlights = new Map<string, Promise<void>>();

export function cacheReference(force = false): Promise<void> {
  const scope = currentScope;
  if (!scope) return Promise.resolve();
  const existing = referenceFlights.get(scope);
  if (existing) return existing;
  const flight = (async () => {
    if (!force && await getKv(`referencia:${scope}`)) return;
    if (scope !== currentScope) return;
    const data = await apiGet("/api/sync/referencia", { fresh: force });
    if (data && scope === currentScope) await putKv(`referencia:${scope}`, data);
  })().finally(() => {
    if (referenceFlights.get(scope) === flight) referenceFlights.delete(scope);
  });
  referenceFlights.set(scope, flight);
  return flight;
}

export async function discardReview(key: string) {
  await deleteConflict(key);
  window.dispatchEvent(new Event("talon-outbox"));
}

export async function cachedReference<T>() {
  if (!currentScope) return null;
  return getKv<T>(`referencia:${currentScope}`);
}
