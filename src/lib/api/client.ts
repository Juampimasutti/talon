import { dedupe } from "./inflight";

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string; details?: unknown };
  if (!res.ok || !body.ok) {
    throw new ApiError(body.error ?? "No se pudo completar la operación", res.status, body.details);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("talon-fetch-ok"));
  return body.data as T;
}

export function apiGet<T>(path: string, opts?: { fresh?: boolean }): Promise<T> {
  const run = () => fetch(path, { headers: { Accept: "application/json" }, cache: "no-cache" }).then((res) => parse<T>(res));
  if (opts?.fresh) return run();
  return dedupe(`GET ${path}`, run);
}

let sessionPromise: Promise<Me> | null = null;
let sessionStamp = 0;

/** Una sola lectura de la sesión para el banner y la pantalla. */
const SESSION_KEY = "talon-session-user";

export function primeSession(me: Me) {
  sessionStamp = Date.now();
  sessionPromise = Promise.resolve(me);
  persistSession(me, sessionStamp);
}

function persistSession(me: Me, at: number) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify({ at, me });
  sessionStorage.setItem(SESSION_KEY, raw);
  localStorage.setItem(SESSION_KEY, raw);
  window.dispatchEvent(new Event("talon-session"));
}

function readStoredSession(store: Storage, maxAge: number | null): Me | null {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at: number; me: Me };
    if (!parsed.me?.user?.id) return null;
    if (maxAge != null && Date.now() - parsed.at >= maxAge) return null;
    return parsed.me;
  } catch {
    store.removeItem(SESSION_KEY);
    return null;
  }
}

function sessionFromStorage(): Me | null {
  if (typeof window === "undefined") return null;
  const fresh = readStoredSession(sessionStorage, 60_000);
  if (!fresh) return null;
  sessionStamp = Date.now();
  return fresh;
}

/** Sesión guardada para armar el shell sin red. No vence a los 60 s. */
export function readDurableSession(): Me | null {
  if (typeof window === "undefined") return null;
  return readStoredSession(localStorage, null) ?? readStoredSession(sessionStorage, null);
}

export function loadSession(): Promise<Me> {
  if (sessionPromise && Date.now() - sessionStamp < 60_000) return sessionPromise;
  const stored = sessionFromStorage();
  if (stored) {
    persistSession(stored, Date.now());
    sessionPromise = Promise.resolve(stored);
    return sessionPromise;
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const durable = offline ? readDurableSession() : null;
  if (durable) return Promise.resolve(durable);
  sessionStamp = Date.now();
  sessionPromise = apiGet<Me>("/api/auth/me")
    .then((me) => {
      persistSession(me, Date.now());
      return me;
    })
    .catch((error) => {
      const saved = readDurableSession();
      const down = offline || (typeof navigator !== "undefined" && navigator.onLine === false) || error instanceof TypeError;
      if (saved && down) return saved;
      sessionPromise = null;
      throw error;
    });
  return sessionPromise;
}

export function clearSessionCache() {
  sessionPromise = null;
  sessionStamp = 0;
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("talon-session"));
}

export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((res) => parse<T>(res));
}

export type Me = {
  user: { id: string; name: string; email: string };
  company: {
    id: string;
    name: string;
    legalName: string;
    cuit: string;
    taxCondition: string;
    pointOfSale: number;
    city: string | null;
    province: string | null;
    modules: string[];
    blockNegativeStock: boolean;
  };
  role: { id: string; key: string; name: string };
  permissions: string[];
  companies: { id: string; name: string; roleName: string }[];
  rlsEnforced: boolean;
};
