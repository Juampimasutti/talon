"use client";

import { CompanyCreateForm } from "./company-create-form";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend, clearSessionCache } from "@/lib/api/client";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CompanyManagement() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const capabilities = useQuery({
    queryKey: ["company-capabilities", me.data?.company.id],
    queryFn: () =>
      apiGet<{ canCreate: boolean; canDestroy: boolean }>(
        "/api/empresas/capacidades",
      ),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [operation, setOperation] = useState<"vaciar" | "eliminar" | "">("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState<{
    downloadUrl: string;
    operation: string;
  } | null>(null);

  if (!me.data || !capabilities.data) return null;
  const company = me.data.company;
  return (
    <section className="mt-5 grid gap-3 border-t pt-4">
      <h2 className="font-semibold">Administración de empresas</h2>
      <a className="text-sm text-primary underline" href="/respaldos">
        Mis respaldos de vaciado y eliminación
      </a>
      {capabilities.data.canCreate ? (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => setCreateOpen(!createOpen)}
        >
          Nueva empresa
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          El alta de empresas requiere autorización global de estudio o
          superadmin.
        </p>
      )}
      {createOpen ? <CompanyCreateForm /> : null}
      {capabilities.data.canDestroy && !completed ? (
        <div className="grid max-w-2xl gap-3 rounded border border-destructive/40 p-4">
          <h3 className="font-semibold">Vaciar o eliminar {company.name}</h3>
          <p className="text-sm">
            Vaciar borra comprobantes, movimientos y existencias; conserva
            maestros, configuración, numeración y auditoría. Eliminar borra toda
            la empresa. Antes se guarda un respaldo descargable.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOperation("vaciar");
                setConfirmation("");
              }}
            >
              Vaciar datos
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setOperation("eliminar");
                setConfirmation("");
              }}
            >
              Eliminar empresa
            </Button>
          </div>
          {operation ? (
            <form
              className="grid gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setPending(true);
                try {
                  if (!navigator.onLine)
                    throw new Error(
                      "Necesitás conexión para hacer esta operación",
                    );
                  const { pendingOperations, reviewItems } = await import(
                    "@/lib/offline/submit"
                  );
                  if (
                    (await pendingOperations()).length ||
                    (await reviewItems()).length
                  )
                    throw new Error(
                      "Primero sincronizá o resolvé las operaciones pendientes de este dispositivo",
                    );
                  const result = await apiSend<{ downloadUrl: string }>(
                    `/api/empresas/${company.id}/${operation}`,
                    "POST",
                    { confirmation },
                  );
                  clearSessionCache();
                  setCompleted({ downloadUrl: result.downloadUrl, operation });
                  if (operation === "eliminar") {
                    queryClient.clear();
                    router.push("/respaldos");
                  } else await queryClient.invalidateQueries();
                  toast.success(
                    operation === "vaciar"
                      ? "Datos vaciados; respaldo guardado"
                      : "Empresa eliminada; respaldo guardado",
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "No se pudo completar",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              <label className="grid gap-1 text-sm">
                Para {operation}, escribí exactamente: {company.name}
                <Input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <Button
                disabled={pending || confirmation !== company.name}
                type="submit"
              >
                {pending
                  ? "Guardando respaldo y procesando…"
                  : `Confirmar ${operation}`}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {completed ? (
        <div role="status" className="grid gap-2 rounded border bg-card p-4">
          <p>
            {completed.operation === "eliminar"
              ? "Empresa eliminada."
              : "Datos operativos vaciados."}{" "}
            El respaldo quedó guardado.
          </p>
          <a
            className="text-primary underline"
            href={completed.downloadUrl}
            download
          >
            Descargar respaldo completo
          </a>
          <a className="text-primary underline" href="/ingreso">
            Volver al ingreso
          </a>
        </div>
      ) : null}
    </section>
  );
}
