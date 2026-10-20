"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { balancePhrase, formatDate, formatMoney, parseMoneyToCents, preferredCashAccountId, todayIso } from "@/lib/format";
import { useCatalog, useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: string; name: string; balanceCents: number };
type Entry = { id: string; occurredOn: string; description: string; debitCents: number; creditCents: number };

export function CuentasScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const queryClient = useQueryClient();
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [anticipo, setAnticipo] = useState(false);
  const list = useQuery({
    queryKey: ["cuentas", me.data?.company.id, partyType],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<{ items: Item[] }>(`/api/cuentas?partyType=${partyType}`),
  });
  const detail = useQuery({
    queryKey: ["cuenta", partyId, partyType],
    enabled: Boolean(partyId),
    queryFn: () => apiGet<{ entries: Entry[] }>(`/api/cuentas?partyType=${partyType}&partyId=${partyId}`),
  });
  const canCollect = me.data ? can(me.data.permissions, "cuentas_corrientes", "crear") && can(me.data.permissions, "caja", "crear") : false;

  const accounts = catalog.data?.cashAccounts ?? [];
  const remembered = me.data && typeof window !== "undefined" ? window.localStorage.getItem(`talon-caja-${me.data.company.id}`) : null;
  const preferred = preferredCashAccountId(accounts, remembered);
  const selectedCash = cashAccountId || preferred;

  async function collect(event: React.FormEvent) {
    event.preventDefault();
    if (!partyId) return;
    if (!amount.trim()) {
      setAmountError("Escribí el importe del cobro");
      toast.error("Escribí el importe del cobro");
      return;
    }
    const amountCents = parseMoneyToCents(amount);
    if (amountCents == null || amountCents <= 0) {
      setAmountError("El importe tiene que ser mayor a cero");
      toast.error("El importe tiene que ser mayor a cero");
      return;
    }
    if (!selectedCash) {
      toast.error("Elegí en qué caja entra el cobro");
      return;
    }
    setAmountError("");
    try {
      await apiSend("/api/cuentas/cobro", "POST", {
        partyType,
        partyId,
        cashAccountId: selectedCash,
        amountCents,
        description: partyType === "customer" ? "Recibo" : "Orden de pago",
        occurredOn: todayIso(),
        anticipo,
      });
      toast.success(partyType === "customer" ? "Recibo emitido. Quedó en Ventas para imprimirlo." : "Pago registrado");
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["cuentas"] });
      await queryClient.invalidateQueries({ queryKey: ["cuenta", partyId] });
      await queryClient.invalidateQueries({ queryKey: ["caja"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo registrar");
    }
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr] md:p-6">
      <section className="grid gap-3">
        <h1 className="text-4xl tracking-tight">Cuentas corrientes</h1>
        <div className="flex gap-2">
          <Button variant={partyType === "customer" ? "default" : "outline"} onClick={() => { setPartyType("customer"); setPartyId(null); }}>
            Clientes
          </Button>
          <Button variant={partyType === "supplier" ? "default" : "outline"} onClick={() => { setPartyType("supplier"); setPartyId(null); }}>
            Proveedores
          </Button>
        </div>
        <ul className="divide-y rounded-xl border bg-card">
          {(list.data?.items ?? []).filter((item) => item.balanceCents !== 0).slice(0, 40).map((item) => (
            <li key={item.id}>
              <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent" onClick={() => setPartyId(item.id)}>
                <span>{item.name}</span>
                <span>{balancePhrase(partyType === "supplier" ? "proveedor" : "cliente", item.balanceCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border bg-card p-4">
        {!partyId ? <p className="text-sm text-muted-foreground">Elegí una cuenta para ver el mayor.</p> : null}
        {detail.data ? (
          <ul className="divide-y">
            {detail.data.entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {entry.description}
                  <span className="block text-muted-foreground">{formatDate(entry.occurredOn)}</span>
                </span>
                <span>{formatMoney(partyType === "customer" ? entry.debitCents - entry.creditCents : entry.creditCents - entry.debitCents)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canCollect && partyId ? (
          <form noValidate onSubmit={collect} className="mt-4 flex flex-wrap gap-2">
            <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Caja del cobro" value={selectedCash} onChange={(event) => setCashAccountId(event.target.value)}>
              {selectedCash ? null : <option value="">Elegí la caja</option>}
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <Input aria-label="Importe del cobro" placeholder="Importe" value={amount} aria-invalid={Boolean(amountError)} onChange={(event) => { setAmount(event.target.value); setAmountError(""); }} />
            {amountError ? <p role="alert" className="w-full text-sm text-destructive">{amountError}</p> : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={anticipo} onChange={(event) => setAnticipo(event.target.checked)} />
              Anticipo
            </label>
            <Button type="submit">{partyType === "customer" ? "Cobrar" : "Pagar"}</Button>
          </form>
        ) : null}
        {canCollect && partyId && !catalog.data?.cashAccounts.length ? <p className="mt-2 text-sm text-muted-foreground">Abrí una caja para poder cobrar o pagar.</p> : null}
      </section>
    </div>
  );
}
