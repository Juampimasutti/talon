"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Account = { id: string; code: string; name: string; parentCode: string | null; imputable: boolean; kind: string };

const KINDS = ["activo", "pasivo", "patrimonio", "ingreso", "egreso"] as const;

export function ContabilidadScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: ["contabilidad", me.data?.company.id],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<{ accounts: Account[] }>("/api/contabilidad"),
  });
  const canCreate = me.data ? can(me.data.permissions, "contabilidad", "crear") : false;
  const canEdit = me.data ? can(me.data.permissions, "contabilidad", "editar") : false;
  const [form, setForm] = useState({ code: "", name: "", parentCode: "", kind: "activo", imputable: true });
  const [editing, setEditing] = useState<Account | null>(null);

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Plan de cuentas</h1>
        <p className="text-sm text-muted-foreground">Cuentas para imputar compras, ventas y movimientos.</p>
      </div>
      {canCreate ? (
        <form noValidate className="grid gap-2 rounded-xl border bg-card p-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          if (!form.code.trim() || !form.name.trim()) { toast.error("Completá el código y el nombre"); return; }
          void apiSend("/api/contabilidad", "POST", form).then(async () => { toast.success("Cuenta creada"); setForm({ code: "", name: "", parentCode: "", kind: "activo", imputable: true }); await queryClient.invalidateQueries({ queryKey: ["contabilidad"] }); }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo crear"));
        }}>
          <Input aria-label="Código" placeholder="Código" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <Input aria-label="Nombre" placeholder="Nombre" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input aria-label="Cuenta padre" placeholder="Cuenta padre" value={form.parentCode} onChange={(event) => setForm({ ...form, parentCode: event.target.value })} />
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Tipo" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            {KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.imputable} onChange={(event) => setForm({ ...form, imputable: event.target.checked })} /> Imputable</label>
          <Button type="submit">Nueva cuenta</Button>
        </form>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {plan.data?.accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm" style={{ paddingLeft: account.parentCode ? 28 : 16 }}>
            {editing?.id === account.id ? (
              <form noValidate className="flex flex-1 flex-wrap gap-2" onSubmit={(event) => {
                event.preventDefault();
                void apiSend(`/api/contabilidad/${account.id}`, "PATCH", { name: editing.name, kind: editing.kind, imputable: editing.imputable }).then(async () => { toast.success("Cuenta actualizada"); setEditing(null); await queryClient.invalidateQueries({ queryKey: ["contabilidad"] }); }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo editar"));
              }}>
                <Input aria-label="Nombre" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                <Button type="submit">Guardar</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              </form>
            ) : (
              <>
                <span><span className="font-semibold">{account.code}</span> {account.name}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {account.imputable ? account.kind : "rubro"}
                  {canEdit ? <Button variant="outline" onClick={() => setEditing(account)}>Editar</Button> : null}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
