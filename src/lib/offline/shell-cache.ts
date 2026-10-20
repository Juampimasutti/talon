/** El overlay de desarrollo rompe la hidratación si queda guardado como documento. */
export function shouldCacheDocument(html: string): boolean {
  return !html.includes("nextjs-portal") && !html.includes("data-nextjs-dev-overlay");
}

/** Un 4xx definitivo no se reintenta. 408 y 429 sí. */
export function shouldRetryStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

export type SessionLike = { company: { modules?: string[] }; permissions?: string[] } | null | undefined;

export function canReadEstacion(session: SessionLike): boolean {
  if (!session?.company.modules?.includes("estacion")) return false;
  return (session.permissions ?? []).some((permission) => permission.startsWith("estacion."));
}

export function estacionPrecachePaths(session: SessionLike): string[] {
  if (!canReadEstacion(session)) return [];
  return ["/api/estacion", "/api/estacion/flota", "/api/estacion/flota-clientes"];
}
