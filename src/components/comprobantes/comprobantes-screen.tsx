"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { useCatalog, useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ComprobantesScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nextNumber, setNextNumber] = useState("1");
  const canEdit = me.data ? can(me.data.permissions, "comprobantes", "editar") : false;
  const canCreate = me.data ? can(me.data.permissions, "comprobantes", "crear") : false;
  const [draft, setDraft] = useState({ code: "FCP", name: "Factura de compra", kind: "compra" });

  async function save(id: string, active: boolean, electronic: boolean) {
    try {
      await apiSend(`/api/comprobantes/${id}`, "PATCH", { name, active, electronic, nextNumber: Number(nextNumber) });
      toast.success("Comprobante actualizado");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["catalogos"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo guardar");
    }
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Comprobantes</h1>
        <p className="text-sm text-muted-foreground">La letra A, B o C se calcula al emitir. Acá definís qué mueve cada tipo y la numeración.</p>
      </div>
      {canCreate ? (
        <form noValidate className="flex flex-wrap gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const purchase = draft.kind === "compra";
          const stockMove = draft.kind === "venta" || draft.kind === "remito" || purchase;
          try {
            await apiSend("/api/comprobantes", "POST", {
              code: draft.code,
              name: draft.name,
              kind: draft.kind,
              sign: 1,
              movesStock: stockMove,
              stockFactor: draft.kind === "compra" ? 1 : stockMove ? -1 : 0,
              movesAccount: true,
              accountSide: purchase ? "credit" : "debit",
              movesCash: true,
              cashDirection: purchase ? "out" : "in",
              movesVat: true,
            });
            toast.success("Comprobante creado");
            await queryClient.invalidateQueries({ queryKey: ["catalogos"] });
            await queryClient.refetchQueries({ queryKey: ["catalogos"] });
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "No se pudo crear");
          }
        }}>
          <Input className="w-24" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
          <Input className="max-w-xs" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <select className="h-8 rounded-lg border px-2 text-sm" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            <option value="venta">Venta</option>
            <option value="compra">Compra</option>
            <option value="pedido">Pedido</option>
            <option value="remito">Remito</option>
          </select>
          <Button type="submit">Nuevo tipo</Button>
        </form>
      ) : null}
      <ul className="grid gap-3">
        {catalog.data?.documentTypes.map((type) => (
          <li key={type.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg">
                  {type.code} · {type.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {type.kind} · próximo {type.nextNumber}
                  {type.movesStock ? " · mueve stock" : ""}
                  {type.movesVat ? " · discrimina IVA" : ""}
                  {type.movesAccount ? " · cuenta corriente" : ""}
                  {type.electronic ? " · electrónico" : ""}
                </p>
              </div>
              {canEdit ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(type.id);
                    setName(type.name);
                    setNextNumber(String(type.nextNumber));
                  }}
                >
                  Editar
                </Button>
              ) : null}
            </div>
            {editing === type.id ? (
              <form
                noValidate
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(type.id, type.active, type.electronic);
                }}
              >
                <Input value={name} onChange={(event) => setName(event.target.value)} />
                <Input className="w-32" value={nextNumber} onChange={(event) => setNextNumber(event.target.value)} />
                <Button type="submit">Guardar</Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
