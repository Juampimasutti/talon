"use client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiSend, clearSessionCache } from "@/lib/api/client";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Backup = {
  id: string;
  companyId: string;
  companyName: string;
  action: string;
  createdAt: string;
  canRestore: boolean;
  compatible: boolean;
  restoreName: string;
};
const LABELS: Record<string, string> = {
  manual: "Manual",
  automatico: "Automático",
  vaciar: "Antes del vaciado",
  eliminar: "Antes de eliminar",
  antes_restaurar: "Antes de recuperar",
};
export function BackupScreen() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const capabilities = useQuery({
    queryKey: ["backup-capabilities", me.data?.company.id],
    queryFn: () =>
      apiGet<{ canCreate: boolean; canDestroy: boolean }>(
        "/api/empresas/capacidades",
      ),
    retry: false,
  });
  const backups = useQuery({
    queryKey: ["company-backups"],
    queryFn: () => apiGet<{ items: Backup[] }>("/api/empresas/respaldos"),
    retry: false,
  });
  const [selected, setSelected] = useState<Backup | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const current = me.data?.company;
  const latest = backups.data?.items.find((b) => b.companyId === current?.id);
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-5">
      <h1 className="text-xl font-semibold">Respaldos y recuperación</h1>
      <p className="text-sm">
        Descargá una copia completa y guardala también fuera de esta
        computadora. Una copia en el mismo disco no protege ante su pérdida.
      </p>
      {capabilities.data?.canDestroy && current ? (
        <section className="grid gap-2 rounded border bg-card p-3">
          <strong>{current.name}</strong>
          <p className="text-sm">
            Último respaldo:{" "}
            {latest
              ? new Date(latest.createdAt).toLocaleString("es-AR", {
                  hour12: false,
                })
              : "No hay uno guardado"}
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Al iniciar Talón, se guarda una copia diaria mientras Talón está
            abierto. Las copias descargadas conservan datos personales:
            compartilas sólo con personas autorizadas.
          </p>
          <Button
            className="w-fit"
            disabled={pending}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setPending(true);
              setError("");
              try {
                await apiSend("/api/empresas/respaldos", "POST", {
                  companyId: current.id,
                });
                await backups.refetch();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "No se pudo guardar el respaldo",
                );
              } finally {
                lock.current = false;
                setPending(false);
              }
            }}
          >
            {pending ? "Guardando…" : "Guardar respaldo ahora"}
          </Button>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {backups.isPending ? <p>Cargando…</p> : null}
      {backups.error ? <p role="alert">{backups.error.message}</p> : null}
      {backups.data?.items.length === 0 ? (
        <p>No hay respaldos guardados.</p>
      ) : null}
      <ul className="divide-y rounded border bg-card">
        {backups.data?.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
          >
            <span>
              {item.companyName}
              <span className="block text-xs text-muted-foreground">
                {LABELS[item.action] ?? item.action} ·{" "}
                {new Date(item.createdAt).toLocaleString("es-AR", {
                  hour12: false,
                })}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="text-primary underline"
                href={`/api/empresas/respaldos/${item.id}`}
                download
              >
                Descargar JSON
              </a>
              {item.canRestore && !item.compatible ? (
                <span className="text-xs text-muted-foreground">
                  Versión anterior: recuperación técnica
                </span>
              ) : null}
              {item.canRestore && item.compatible ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setSelected(item);
                    setConfirmation("");
                    setError("");
                  }}
                >
                  Recuperar
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !lock.current) setSelected(null);
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Recuperar {selected?.companyName}</DialogTitle>
          </DialogHeader>
          <p>
            Se reemplazan los datos de esta empresa por la copia del{" "}
            {selected
              ? new Date(selected.createdAt).toLocaleString("es-AR", {
                  hour12: false,
                })
              : ""}
            . Si la empresa existe, primero se guarda otro respaldo de su estado
            actual.
          </p>
          <p>
            Sincronizá también los demás dispositivos antes de continuar. Se
            conservan los números ya utilizados. Los demás colaboradores quedan
            desactivados hasta que revises sus accesos. No recupera usuarios
            eliminados ni cambia autorizaciones globales.
          </p>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selected || lock.current) return;
              lock.current = true;
              setPending(true);
              setError("");
              try {
                const { listOps, listConflicts, putKv } = await import(
                  "@/lib/offline/idb"
                );
                const [pendingOps, conflicts] = await Promise.all([
                  listOps(),
                  listConflicts(),
                ]);
                if (
                  [...pendingOps, ...conflicts].some((op) =>
                    op.owner?.endsWith(`:${selected.companyId}`),
                  )
                )
                  throw Error(
                    "Antes de recuperar, sincronizá o revisá las operaciones pendientes de esta empresa en el dispositivo.",
                  );
                const restored = await apiSend<{
                  companyId: string;
                  userId: string;
                }>(`/api/empresas/respaldos/${selected.id}/restaurar`, "POST", {
                  confirmation,
                });
                await putKv(
                  `referencia:${restored.userId}:${restored.companyId}`,
                  null,
                ).catch(() => undefined);
                // Recargar limpia sesión y consultas del estado anterior a la recuperación.
                clearSessionCache();
                queryClient.clear();
                router.replace("/ingreso");
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "No se pudo recuperar",
                );
              } finally {
                lock.current = false;
                setPending(false);
              }
            }}
          >
            <label className="grid gap-1">
              Escribí exactamente: {selected?.restoreName}
              <Input
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={pending || confirmation !== selected?.restoreName}
            >
              {pending
                ? "Guardando respaldo y recuperando…"
                : "Confirmar recuperación"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {capabilities.data?.canCreate ? (
        <a className="text-primary underline" href="/alta-empresa">
          Crear otra empresa
        </a>
      ) : null}
      <a
        className="text-primary underline"
        href={me.data ? "/configuracion" : "/ingreso"}
      >
        Volver
      </a>
    </main>
  );
}
