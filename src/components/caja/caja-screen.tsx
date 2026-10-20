"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { cajaDifferenceText, conceptoError, formatDate, formatMoney, parseMoneyToCents, todayIso } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Cash = {
  accounts: { id: string; name: string; kind: string; active: boolean }[];
  balances: Record<string, number>;
  sessionBalances?: Record<string, number>;
  movements: { id: string; direction: string; amountCents: number; description: string; occurredOn: string; cashAccountId: string }[];
};

export function CajaScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const caja = useQuery({
    queryKey: ["caja", me.data?.company.id],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<Cash>("/api/caja"),
  });
  const [form, setForm] = useState({ account: "", direction: "in", amount: "", description: "Ingreso de mostrador", date: todayIso() });
  const [name, setName] = useState("");
  const [arqueo, setArqueo] = useState<{ id: string; name: string; balance: number; counted: string } | null>(null);
  const [abrir, setAbrir] = useState<{ id: string; name: string; amount: string } | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState<{ countedCents: number; gap: number } | null>(null);
  const [cajaId, setCajaId] = useState("");
  const canCreate = me.data ? can(me.data.permissions, "caja", "crear") : false;
  const canEdit = me.data ? can(me.data.permissions, "caja", "editar") : false;
  const openAccounts = (caja.data?.accounts ?? []).filter((account) => account.active);
  const remembered = typeof window !== "undefined" && me.data ? window.localStorage.getItem(`talon-caja-${me.data.company.id}`) : "";
  const currentCaja = cajaId || (remembered && openAccounts.some((account) => account.id === remembered) ? remembered : "") || openAccounts.find((account) => account.kind === "caja")?.id || openAccounts[0]?.id || "";
  function chooseCaja(id: string) {
    setCajaId(id);
    if (me.data) window.localStorage.setItem(`talon-caja-${me.data.company.id}`, id);
  }
  function patchCash(id: string, patch: { active?: boolean; balance?: number; sessionBalance?: number; movement?: Cash["movements"][number] }) {
    if (!me.data) return;
    queryClient.setQueryData<Cash>(["caja", me.data.company.id], (current) => {
      if (!current) return current;
      return {
        ...current,
        accounts: current.accounts.map((account) => account.id === id && patch.active != null ? { ...account, active: patch.active } : account),
        balances: patch.balance == null ? current.balances : { ...current.balances, [id]: patch.balance },
        sessionBalances: patch.sessionBalance == null ? current.sessionBalances : { ...current.sessionBalances, [id]: patch.sessionBalance },
        movements: patch.movement ? [patch.movement, ...current.movements] : current.movements,
      };
    });
  }
  const movements = (caja.data?.movements ?? []).filter((movement) => !currentCaja || movement.cashAccountId === currentCaja);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const amountCents = parseMoneyToCents(form.amount);
      const concept = conceptoError(form.description);
      if (concept) { toast.error(concept); return; }
      if (amountCents == null || amountCents <= 0) { toast.error("El importe tiene que ser mayor a cero"); return; }
      const cashAccountId = form.account || currentCaja;
      chooseCaja(cashAccountId);
      await apiSend("/api/caja/movimientos", "POST", {
        cashAccountId,
        direction: form.direction,
        amountCents,
        description: form.description,
        occurredOn: form.date,
      });
      toast.success("Movimiento anotado");
      await queryClient.invalidateQueries({ queryKey: ["caja"] });
      await queryClient.invalidateQueries({ queryKey: ["tablero"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo anotar");
    }
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <h1 className="text-4xl tracking-tight">Caja</h1>
      {caja.data && caja.data.accounts.length === 0 ? <p className="text-sm text-muted-foreground">Esta empresa todavía no tiene caja.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {caja.data?.accounts.map((account) => (
          <article key={account.id} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{account.name} · {account.active ? "abierta" : "cerrada"}</p>
            <p className="text-2xl">{formatMoney(account.active ? (caja.data?.sessionBalances?.[account.id] ?? caja.data?.balances[account.id] ?? 0) : (caja.data?.balances[account.id] ?? 0))}</p>
            {account.active ? <p className="text-sm text-muted-foreground">Esta apertura. Histórico {formatMoney(caja.data?.balances[account.id] ?? 0)}</p> : null}
            {canEdit ? (
              <Button className="mt-2" variant="outline" onClick={() => {
                if (!account.active) {
                  setAbrir({ id: account.id, name: account.name, amount: "0" });
                  return;
                }
                setArqueo({ id: account.id, name: account.name, balance: caja.data?.sessionBalances?.[account.id] ?? caja.data?.balances[account.id] ?? 0, counted: "" });
              }}>
                {account.active ? "Cerrar" : "Abrir"}
              </Button>
            ) : null}
          </article>
        ))}
      </div>
      {canCreate ? (
          <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) { toast.error("Poné el nombre de la caja"); return; } void apiSend("/api/caja", "POST", { name: name.trim() }).then(async () => { toast.success("Caja creada"); setName(""); await queryClient.invalidateQueries({ queryKey: ["caja"] }); }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo crear")); }}>
          <Input className="max-w-xs" aria-label="Nombre de la caja" placeholder="Nombre de la caja" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="outline" onClick={(event) => { if (!name.trim()) { event.preventDefault(); toast.error("Poné el nombre de la caja"); } }}>Nueva caja</Button>
        </form>
      ) : null}
      <Dialog open={Boolean(abrir)} onOpenChange={(open) => { if (!open) setAbrir(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Abrir {abrir?.name}</DialogTitle></DialogHeader>
          <form noValidate className="grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (!abrir) return;
            if (!abrir.amount.trim()) { toast.error("Escribí el saldo de apertura. Si no hay plata, poné 0."); return; }
            const openingCents = parseMoneyToCents(abrir.amount);
            if (openingCents == null) { toast.error("El saldo de apertura tiene que ser un número. 0 también vale."); return; }
            void apiSend("/api/caja/abrir", "POST", { cashAccountId: abrir.id, openingCents }).then(() => {
              toast.success(openingCents === 0 ? "Caja abierta en cero" : "Caja abierta");
              const previous = caja.data?.balances[abrir.id] ?? 0;
              patchCash(abrir.id, {
                active: true,
                balance: previous + openingCents,
                sessionBalance: openingCents,
                movement: { id: `local-${abrir.id}`, direction: "in", amountCents: openingCents, description: "Saldo de apertura", occurredOn: todayIso(), cashAccountId: abrir.id },
              });
              setAbrir(null);
            }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo"));
          }}>
            <p className="text-sm text-muted-foreground">Saldo de apertura. Si no hay plata, escribí 0.</p>
            <Input aria-label="Saldo de apertura" value={abrir?.amount ?? ""} onChange={(event) => setAbrir(abrir ? { ...abrir, amount: event.target.value } : abrir)} />
            <Button type="submit">Abrir caja</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(confirmarCierre && arqueo)} onOpenChange={(open) => { if (!open) setConfirmarCierre(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar cierre de {arqueo?.name}</DialogTitle></DialogHeader>
          <p className="text-sm">Esperado {formatMoney(arqueo?.balance ?? 0)}. Contado {formatMoney(confirmarCierre?.countedCents ?? 0)}. {cajaDifferenceText(arqueo?.balance ?? 0, confirmarCierre?.countedCents ?? 0)}.</p>
          <div className="flex gap-2">
            <Button onClick={() => {
              if (!arqueo || !confirmarCierre) return;
              void apiSend("/api/caja/cerrar", "POST", { cashAccountId: arqueo.id, countedCents: confirmarCierre.countedCents }).then(() => {
                toast.success(confirmarCierre.gap === 0 ? "Caja cerrada. El arqueo coincide." : `Caja cerrada. ${cajaDifferenceText(arqueo.balance, confirmarCierre.countedCents)}`);
                patchCash(arqueo.id, { active: false });
                setConfirmarCierre(null);
                setArqueo(null);
              }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo cerrar"));
            }}>Confirmar cierre</Button>
            <Button variant="outline" onClick={() => setConfirmarCierre(null)}>Volver</Button>
          </div>
        </DialogContent>
      </Dialog>
      {arqueo ? (
        <form noValidate className="grid max-w-md gap-2 rounded-xl border bg-card p-4" onSubmit={(event) => {
          event.preventDefault();
          const countedCents = parseMoneyToCents(arqueo.counted);
          if (countedCents == null) { toast.error("El arqueo tiene que ser un importe"); return; }
          const gap = countedCents - arqueo.balance;
          setConfirmarCierre({ countedCents, gap });
        }}>
          <p className="font-semibold">Arqueo de {arqueo.name}</p>
          <p className="text-sm text-muted-foreground">El sistema tiene {formatMoney(arqueo.balance)}. Contá el efectivo y anotá el importe.</p>
          <Input aria-label="Importe contado" placeholder="Importe contado" value={arqueo.counted} onChange={(event) => setArqueo({ ...arqueo, counted: event.target.value })} />
          <div className="flex gap-2">
            <Button type="submit">Cerrar caja</Button>
            <Button type="button" variant="outline" onClick={() => setArqueo(null)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
      {canCreate && openAccounts.length ? (
        <form noValidate onSubmit={save} className="grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-5">
          <select className="h-8 rounded-lg border px-2 text-sm" value={form.account || currentCaja} onChange={(event) => { setForm({ ...form, account: event.target.value }); chooseCaja(event.target.value); }}>
            {openAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <select className="h-8 rounded-lg border px-2 text-sm" value={form.direction} onChange={(event) => {
            const direction = event.target.value;
            const preset = form.direction === "out" ? "Egreso de caja" : "Ingreso de mostrador";
            const next = direction === "out" ? "Egreso de caja" : "Ingreso de mostrador";
            setForm({ ...form, direction, description: form.description === preset ? next : form.description });
          }}>
            <option value="in">Entra</option>
            <option value="out">Sale</option>
          </select>
          <Input aria-label="Importe" placeholder="Importe" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          <Input aria-label="Concepto" placeholder="Concepto" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <Button type="submit">Anotar</Button>
        </form>
      ) : null}
      <label className="grid max-w-xs gap-1 text-sm">Caja
        <select className="h-8 rounded-lg border px-2" value={currentCaja} onChange={(event) => chooseCaja(event.target.value)}>
          {openAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <ul className="divide-y rounded-xl border bg-card">
        {movements.map((movement) => (
          <li key={movement.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              {movement.description}
              <span className="block text-muted-foreground">{formatDate(movement.occurredOn)}</span>
            </span>
            <span>
              {movement.direction === "in" ? "+" : "−"}
              {formatMoney(movement.amountCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
