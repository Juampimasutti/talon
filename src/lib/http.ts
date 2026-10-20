import { constraintMessage } from "./guards";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function ok(data: unknown, cache?: string): Response {
  return Response.json(
    { ok: true, data },
    { headers: { "Cache-Control": cache ?? "private, no-store" } },
  );
}

export function fail(status: number, error: string, details?: unknown): Response {
  return Response.json({ ok: false, error, details: details ?? null }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function withErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, error.details);
    let current: unknown = error;
    let code = "";
    let message = "";
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (typeof current === "object" && current && "code" in current) code = String((current as { code?: string }).code);
      if (current instanceof Error) message += ` ${current.message}`;
      current = typeof current === "object" && current && "cause" in current ? (current as { cause?: unknown }).cause : null;
    }
    if (code === "42501" || message.includes("row-level security")) {
      return fail(403, "No tenés permiso para hacer eso");
    }
    const friendly = constraintMessage(code, message);
    if (friendly) return fail(code === "22P02" ? 400 : 409, friendly);
    console.error(error);
    return fail(500, "Ocurrió un error interno. Si sigue, mirá el log del servidor.");
  }
}

export function likeTerm(value: string): string {
  return `%${value.replace(/[%_\\]/g, "").slice(0, 80)}%`;
}

export function pageParams(url: URL, fallbackSize = 40) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? fallbackSize) || fallbackSize));
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  return { page, pageSize, q, offset: (page - 1) * pageSize };
}

export const CATALOG_CACHE = "private, max-age=60, stale-while-revalidate=120";
