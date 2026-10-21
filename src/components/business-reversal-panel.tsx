"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Operation = { id: string; resource: string; label: string };
type Preview = {
  fingerprint: string;
  effects: string[];
  cashDeltaCents: number;
  documentCount: number;
  operationCount: number;
};
export function BusinessReversalPanel({
  sector,
}: {
  sector: "inmobiliaria" | "constructora";
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Operation | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const list = useQuery({
    queryKey: ["reversiones", me.data?.company.id, sector],
    enabled: open,
    queryFn: () =>
      apiGet<{
        items: Operation[];
        history: {
          id: string;
          reason: string;
          created_at: string;
          user_name: string;
        }[];
      }>(`/api/reversiones/${sector}`),
  });
  const preview = useQuery({
    queryKey: [
      "reversion-preview",
      me.data?.company.id,
      sector,
      selected?.resource,
      selected?.id,
    ],
    enabled: Boolean(selected),
    retry: false,
    staleTime: 0,
    queryFn: () =>
      apiGet<Preview>(
        `/api/reversiones/${sector}/${selected!.resource}/${selected!.id}`,
        { fresh: true },
      ),
  });
  return (
    <section className="grid gap-2">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => setOpen(!open)}
      >
        Corregir / anular operaciones
      </Button>
      {open ? (
        <div className="grid gap-3 rounded border bg-card p-3">
          <p className="text-sm">
            La vista previa indica qué comprobantes y movimientos se revierten
            juntos. Los originales se conservan anulados y el motivo queda en el
            historial.
          </p>
          {list.isPending ? <p>Cargando operaciones…</p> : null}
          {list.error ? <p role="alert">{list.error.message}</p> : null}
          <label className="grid gap-1 text-sm">
            Operación a corregir
            <select
              aria-label="Operación a corregir"
              className="h-9 min-w-0 max-w-full rounded border px-2"
              value=""
              onChange={(event) => {
                const item = list.data?.items.find(
                  (i) => `${i.resource}/${i.id}` === event.target.value,
                );
                if (item) {
                  setSelected(item);
                  setReason("");
                  setConfirmation("");
                  setError("");
                }
              }}
            >
              <option value="">Elegí una operación</option>
              {list.data?.items.map((item) => (
                <option
                  key={`${item.resource}/${item.id}`}
                  value={`${item.resource}/${item.id}`}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {list.data?.items.length === 0 ? (
            <p className="text-sm">No hay operaciones para corregir.</p>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm">
              Historial de reversiones
            </summary>
            <ul className="divide-y">
              {list.data?.history.map((item) => (
                <li key={item.id} className="py-2 text-sm">
                  {item.reason}
                  <span className="block text-xs text-muted-foreground">
                    {item.user_name} ·{" "}
                    {new Date(item.created_at).toLocaleString("es-AR", {
                      hour12: false,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            {list.data?.history.length === 0 ? (
              <p className="text-sm">Sin reversiones.</p>
            ) : null}
          </details>
        </div>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(value) => {
          if (!value && !lock.current) setSelected(null);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>Revisar anulación</DialogTitle>
          </DialogHeader>
          <p className="font-medium">{selected?.label}</p>
          {preview.isFetching ? <p role="status">Calculando efectos…</p> : null}
          {preview.error ? (
            <p role="alert" className="text-destructive">
              {preview.error.message}
            </p>
          ) : null}
          {preview.data && !preview.error ? (
            <>
              <ul className="list-disc space-y-2 pl-4 text-sm">
                {preview.data.effects.map((effect, index) => (
                  <li key={index}>{effect}</li>
                ))}
              </ul>
              <p className="text-sm">
                Comprobantes a anular: {preview.data.documentCount}. Cambio
                total en caja:{" "}
                <strong>{formatMoney(preview.data.cashDeltaCents)}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                La anulación registra la corrección. Si hubo entrega o
                devolución de dinero, confirmá que también se haya realizado.
              </p>
              <form
                className="grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (lock.current || !selected) return;
                  lock.current = true;
                  setPending(true);
                  setError("");
                  try {
                    await apiSend(
                      `/api/reversiones/${sector}/${selected.resource}/${selected.id}`,
                      "POST",
                      {
                        reason,
                        confirmation,
                        fingerprint: preview.data!.fingerprint,
                      },
                    );
                    setSelected(null);
                    await queryClient.invalidateQueries();
                    toast.success("Operación anulada y movimientos revertidos");
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "No se pudo anular",
                    );
                    await preview.refetch();
                  } finally {
                    lock.current = false;
                    setPending(false);
                  }
                }}
              >
                <label className="grid gap-1 text-sm">
                  Motivo de la corrección
                  <Input
                    value={reason}
                    minLength={5}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Para confirmar, escribí ANULAR
                  <Input
                    value={confirmation}
                    autoComplete="off"
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
                  disabled={
                    pending ||
                    preview.isFetching ||
                    reason.trim().length < 5 ||
                    confirmation !== "ANULAR"
                  }
                >
                  {pending ? "Revirtiendo movimientos…" : "Confirmar anulación"}
                </Button>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
