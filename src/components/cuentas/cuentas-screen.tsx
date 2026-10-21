"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can, moduleEnabled } from "@/lib/auth/permissions";
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
  const [chosenType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [anticipo, setAnticipo] = useState(false);
  const [pending, setPending] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const submitLock = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const canSeeCustomers = Boolean(me.data && can(me.data.permissions, "clientes", "ver"));
  const canSeeSuppliers = Boolean(me.data && can(me.data.permissions, "proveedores", "ver"));
  const partyType = canSeeSuppliers && (chosenType === "supplier" || !canSeeCustomers) ? "supplier" : "customer";
  const list = useQuery({
    queryKey: ["cuentas", me.data?.company.id, partyType],
    enabled: Boolean(me.data && (canSeeCustomers || canSeeSuppliers)),
    queryFn: () => apiGet<{ items: Item[] }>(`/api/cuentas?partyType=${partyType}`),
  });
  const detail = useQuery({
    queryKey: ["cuenta", me.data?.company.id, partyId, partyType],
    enabled: Boolean(me.data && partyId),
    queryFn: () => apiGet<{ entries: Entry[] }>(`/api/cuentas?partyType=${partyType}&partyId=${partyId}`),
  });
  const canCollect = me.data ? can(me.data.permissions, "cuentas_corrientes", "crear") && can(me.data.permissions, "caja", "crear") : false;
  const canViewReceipt = Boolean(me.data && moduleEnabled(me.data.company.modules, "ventas") && can(me.data.permissions, "ventas", "ver"));
  const selectedParty = list.data?.items.find(item => item.id === partyId);
  const visibleItems = (list.data?.items ?? []).filter(item => item.balanceCents !== 0 && item.name.toLocaleLowerCase("es-AR").includes(search.trim().toLocaleLowerCase("es-AR")));
  const accounts = catalog.data?.cashAccounts ?? [];
  const remembered = me.data && typeof window !== "undefined" ? window.localStorage.getItem(`talon-caja-${me.data.company.id}`) : null;
  const preferred = preferredCashAccountId(accounts, remembered);
  const selectedCash = cashAccountId || preferred;
  const paying = partyType === "supplier";

  function chooseParty(id: string | null) {
    if (submitLock.current) return;
    setPartyId(id);
    setAmount("");
    setAmountError("");
    setSubmitError("");
    setAnticipo(false);
    setReceiptId(null);
  }

  async function collect(event: React.FormEvent) {
    event.preventDefault();
    if (submitLock.current || !partyId) return;
    if (!amount.trim()) {
      setAmountError(paying ? "Escribí el importe del pago" : "Escribí el importe del cobro");
      amountRef.current?.focus();
      return;
    }
    const amountCents = parseMoneyToCents(amount);
    if (amountCents == null || amountCents <= 0) {
      setAmountError("El importe tiene que ser mayor a cero");
      amountRef.current?.focus();
      return;
    }
    if (!selectedCash) {
      setSubmitError(paying ? "Elegí de qué caja sale el pago" : "Elegí en qué caja entra el cobro");
      return;
    }
    submitLock.current = true;
    setPending(true);
    setAmountError("");
    setSubmitError("");
    setReceiptId(null);
    try {
      const result = await apiSend<{ id: string }>("/api/cuentas/cobro", "POST", {
        partyType,
        partyId,
        cashAccountId: selectedCash,
        amountCents,
        description: paying ? "Orden de pago" : "Recibo",
        occurredOn: todayIso(),
        anticipo,
      });
      if (!paying) setReceiptId(result.id);
      toast.success(paying ? "Pago registrado" : "Recibo emitido");
      setAmount("");
      setAnticipo(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cuentas", me.data?.company.id] }),
        queryClient.invalidateQueries({ queryKey: ["cuenta", me.data?.company.id, partyId, partyType] }),
        queryClient.invalidateQueries({ queryKey: ["caja"] }),
        queryClient.invalidateQueries({ queryKey: ["tablero"] }),
        queryClient.invalidateQueries({ queryKey: ["documentos", me.data?.company.id] }),
      ]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "No se pudo confirmar el registro. Revisá los movimientos antes de volver a enviarlo.";
      setSubmitError(message);
    } finally {
      submitLock.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid items-start gap-4 p-4 md:grid-cols-[1fr_1fr] md:p-6">
      <section className={`${partyId ? "hidden md:grid" : "grid"} min-w-0 gap-3`}>
        <h1 className="text-4xl tracking-tight">Cuentas corrientes</h1>
        <div className="flex gap-2">
          {canSeeCustomers ? <Button disabled={pending} variant={partyType === "customer" ? "default" : "outline"} onClick={() => { chooseParty(null); setPartyType("customer"); setSearch(""); }}>Clientes</Button> : null}
          {canSeeSuppliers ? <Button disabled={pending} variant={partyType === "supplier" ? "default" : "outline"} onClick={() => { chooseParty(null); setPartyType("supplier"); setSearch(""); }}>Proveedores</Button> : null}
        </div>
        <Input aria-label="Buscar cuenta por nombre" placeholder={paying ? "Buscar proveedor" : "Buscar cliente"} value={search} onChange={event => setSearch(event.target.value)} />
        {list.isError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar las cuentas. <button type="button" className="underline" onClick={() => void list.refetch()}>Reintentar</button></p> : null}
        {list.isLoading ? <p className="text-sm text-muted-foreground">Cargando cuentas…</p> : null}
        {!list.isLoading && !list.isError && !visibleItems.length ? <p className="text-sm text-muted-foreground">{search ? "No hay cuentas con saldo para esa búsqueda." : "No hay cuentas con saldo pendiente."}</p> : null}
        <ul className="divide-y rounded border bg-card">
          {visibleItems.slice(0, 40).map(item => (
            <li key={item.id}>
              <button type="button" disabled={pending} aria-pressed={item.id === partyId} className="flex min-h-14 w-full flex-col items-start justify-between gap-1 px-3 py-3 text-left hover:bg-accent aria-pressed:bg-accent disabled:opacity-60 lg:flex-row lg:items-center" onClick={() => chooseParty(item.id)}>
                <span className="min-w-0 break-words font-medium">{item.name}</span>
                <span className="text-sm tabular-nums">{balancePhrase(paying ? "proveedor" : "cliente", item.balanceCents)}</span>
              </button>
            </li>
          ))}
        </ul>
        {visibleItems.length > 40 ? <p className="text-xs text-muted-foreground">Mostrando 40 de {visibleItems.length} cuentas. Afiná la búsqueda para encontrar otra.</p> : null}
      </section>
      <section className="min-w-0 rounded border bg-card p-4" aria-label="Detalle de cuenta">
        {!partyId ? (
          <div className="grid gap-3">
            <h2 className="font-semibold">{paying ? "Saldos de proveedores" : "Saldos de clientes"}</h2>
            <p className="text-xl font-semibold tabular-nums">{list.data ? balancePhrase(paying ? "proveedor" : "cliente", list.data.items.reduce((sum, item) => sum + item.balanceCents, 0)) : "Cargando saldos…"}</p>
            <p className="text-sm text-muted-foreground">Elegí una cuenta para ver sus movimientos y {paying ? "registrar un pago" : "cobrar"}.</p>
          </div>
        ) : (
          <>
            <Button className="mb-3 md:hidden" variant="outline" disabled={pending} onClick={() => chooseParty(null)}>← Cambiar cuenta</Button>
            <h2 className="break-words font-semibold">{selectedParty?.name ?? "Cuenta seleccionada"}</h2>
            <p className="mt-1 text-lg font-semibold tabular-nums" aria-live="polite">{selectedParty ? balancePhrase(paying ? "proveedor" : "cliente", selectedParty.balanceCents) : "Actualizando saldo…"}</p>
          </>
        )}
        {canCollect && partyId ? (
          <form noValidate onSubmit={collect} className="mt-4 grid gap-3 border-t pt-4">
            <h3 className="font-medium">{paying ? "Registrar pago" : "Registrar cobro"}</h3>
            <fieldset disabled={pending} className="grid min-w-0 gap-3">
              <label className="grid min-w-0 gap-1 text-sm">{paying ? "Caja de salida" : "Caja de ingreso"}
                <select className="h-10 w-full min-w-0 rounded border px-2 text-base md:text-sm" aria-label={paying ? "Caja del pago" : "Caja del cobro"} value={selectedCash} onChange={event => setCashAccountId(event.target.value)}>
                  {selectedCash ? null : <option value="">Elegí la caja</option>}
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Importe
                <Input ref={amountRef} className="h-11 text-lg tabular-nums" inputMode="decimal" aria-label={paying ? "Importe del pago" : "Importe del cobro"} placeholder="0,00" value={amount} aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "collection-amount-error" : undefined} onChange={event => { setAmount(event.target.value); setAmountError(""); }} />
              </label>
              {amountError ? <p id="collection-amount-error" role="alert" className="text-sm text-destructive">{amountError}</p> : null}
              {selectedParty && selectedParty.balanceCents > 0 ? <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => { setAmount((selectedParty.balanceCents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })); setAmountError(""); amountRef.current?.focus(); }}>Usar saldo completo: {formatMoney(selectedParty.balanceCents)}</Button> : null}
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={anticipo} onChange={event => setAnticipo(event.target.checked)} /> Anticipo
              </label>
              <p className="text-xs text-muted-foreground">Marcá anticipo sólo si querés registrar un importe a favor por encima del saldo.</p>
              <Button className="h-11 w-full" type="submit">{pending ? "Registrando…" : paying ? "Pagar" : "Cobrar"}</Button>
            </fieldset>
            {submitError ? <p role="alert" className="text-sm text-destructive">{submitError}</p> : null}
          </form>
        ) : null}
        {receiptId ? <p role="status" className="mt-3 rounded border p-3 text-sm">Recibo registrado. {canViewReceipt ? <Link href={`/ventas/${receiptId}`} className="font-medium text-primary underline">Ver recibo e imprimir</Link> : null}</p> : null}
        {canCollect && partyId && catalog.data && !accounts.length ? <p className="mt-2 text-sm text-muted-foreground">Abrí una caja para poder cobrar o pagar.</p> : null}
        {partyId ? <details key={`${partyType}-${partyId}`} className="mt-4 border-t pt-3">
          <summary className="cursor-pointer py-1 text-sm font-medium">Ver movimientos de la cuenta</summary>
          {detail.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Cargando movimientos…</p> : null}
          {detail.isError ? <p role="alert" className="mt-2 text-sm text-destructive">No se pudieron cargar los movimientos. <button type="button" className="underline" onClick={() => void detail.refetch()}>Reintentar</button></p> : null}
          {detail.data ? <ul className="mt-2 divide-y">
            {detail.data.entries.map(entry => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-words">{entry.description}<span className="block text-muted-foreground">{formatDate(entry.occurredOn)}</span></span>
                <span className="tabular-nums">{formatMoney(paying ? entry.creditCents - entry.debitCents : entry.debitCents - entry.creditCents)}</span>
              </li>
            ))}
          </ul> : null}
        </details> : null}
      </section>
    </div>
  );
}
