"use client";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";

export function BackupScreen() {
  const capabilities = useQuery({
    queryKey: ["backup-capabilities"],
    queryFn: () => apiGet<{ canCreate: boolean }>("/api/empresas/capacidades"),
    retry: false,
  });
  const backups = useQuery({
    queryKey: ["company-backups"],
    queryFn: () =>
      apiGet<{
        items: {
          id: string;
          companyName: string;
          action: string;
          createdAt: string;
        }[];
      }>("/api/empresas/respaldos"),
    retry: false,
  });
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-5">
      <h1 className="text-xl font-semibold">Mis respaldos de empresas</h1>
      <p className="text-sm">
        Incluye los respaldos de empresas eliminadas por tu usuario. Necesitás
        la sesión con la que hiciste la operación.
      </p>
      {backups.isPending ? <p>Cargando…</p> : null}
      {backups.error ? <p role="alert">{backups.error.message}</p> : null}
      {backups.data?.items.length === 0 ? (
        <p>No hay respaldos guardados.</p>
      ) : null}
      <ul className="divide-y rounded border bg-card">
        {backups.data?.items.map((item) => (
          <li
            className="flex flex-wrap justify-between gap-2 p-3 text-sm"
            key={item.id}
          >
            <span>
              {item.companyName} · {item.action} ·{" "}
              {new Date(item.createdAt).toLocaleString("es-AR")}
            </span>
            <a
              className="text-primary underline"
              href={`/api/empresas/respaldos/${item.id}`}
              download
            >
              Descargar JSON
            </a>
          </li>
        ))}
      </ul>
      {capabilities.data?.canCreate ? (
        <a href="/alta-empresa" className="text-primary underline">
          Crear otra empresa
        </a>
      ) : null}
      <a href="/ingreso" className="text-primary underline">
        Volver al ingreso
      </a>
    </main>
  );
}
