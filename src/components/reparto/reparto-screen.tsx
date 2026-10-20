"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { formatMeasure, formatMoney, formatQty, parseLocaleNumber, parseMoneyToCents, todayIso } from "@/lib/format";
import { useBrowserReady, readRetryPayload } from "@/components/use-browser-ready";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Board = {
  canEdit: boolean;
  canCreate: boolean;
  trucks: { id: string; plate: string; name: string }[];
  compartments: { id: string; truck_id: string; name: string; product_name: string; capacity: string; quantity: string }[];
  trips: { id: string; truck_id: string; driver_name: string; status: string; km_start: string | null; km_end: string | null }[];
  events: { id: string; trip_id: string; kind: string; liters: string | null; amount_cents: string | null; note: string | null; document_id: string | null }[];
  tanks: { id: string; name: string; capacity?: string }[];
  customers: { id: string; name: string }[];
  summary: { truck: string; driver: string; liters: string; expenses: string; shrinkage: string }[];
};

export function RepartoScreen() {
  const ready = useBrowserReady();
  return ready ? <RepartoForm /> : <p className="p-6 text-sm">Abriendo reparto…</p>;
}

function RepartoForm() {
  const [retry] = useState(() => readRetryPayload("reparto"));
  const me = useMe();
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: ["reparto", me.data?.company.id],
    enabled: Boolean(me.data),
    placeholderData: keepPreviousData,
    queryFn: () => apiGet<Board>("/api/reparto"),
  });
  const clients = useQuery({
    queryKey: ["reparto-clientes", me.data?.company.id],
    enabled: Boolean(me.data),
    placeholderData: keepPreviousData,
    queryFn: () => apiGet<{ customers: { id: string; name: string }[] }>("/api/reparto/clientes"),
  });
  const [truckId, setTruckId] = useState("");
  const [compartmentId, setCompartmentId] = useState(String(retry?.compartmentId ?? ""));
  const [tankId, setTankId] = useState("");
  const [customerId, setCustomerId] = useState(String(retry?.customerId ?? ""));
  const [liters, setLiters] = useState(String(retry?.liters ?? "500"));
  const [km, setKm] = useState("");
  const [kmEnd, setKmEnd] = useState("");
  const [mermaAsk, setMermaAsk] = useState<{ text: string; run: () => void } | null>(null);
  const [expense, setExpense] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [documentKind, setDocumentKind] = useState<"remito" | "factura">(retry?.document === "factura" ? "factura" : "remito");
  const [askClose, setAskClose] = useState(false);
  const board = data.data;
  const customers = clients.data?.customers?.length ? clients.data.customers : (board?.customers ?? []);
  useEffect(() => {
    if (retry) sessionStorage.removeItem("talon-retry-op");
  }, [retry]);
  const trip = board?.trips.find((item) => item.status === "abierto") ?? null;
  const compartments = (board?.compartments ?? []).filter((item) => item.truck_id === (trip?.truck_id || truckId));

  async function emitir(document: "remito" | "factura") {
    const ids = (board?.events ?? []).filter((event) => event.kind === "entrega" && !event.document_id).map((event) => event.id);
    if (!ids.length) {
      toast.error("No hay entregas sin comprobante");
      return;
    }
    await send("/api/reparto/comprobantes", { eventIds: ids, document }, document === "factura" ? "Factura emitida" : "Remito emitido");
  }

  async function send(path: string, body: Record<string, unknown>, message: string) {
    try {
      const kind = path.endsWith("/carga") ? "reparto.carga" : path.endsWith("/entrega") ? "reparto.entrega" : path.endsWith("/retorno") ? "reparto.retorno" : null;
      if (kind) {
        if (kind === "reparto.entrega") {
          queryClient.setQueryData<Board>(["reparto", me.data?.company.id], (current) => current ? {
            ...current,
            events: [...current.events, { id: `local-${crypto.randomUUID()}`, trip_id: String(body.tripId), kind: "entrega", liters: String(body.liters), amount_cents: null, note: "Entrega", document_id: null }],
          } : current);
        }
        const { submitQueued } = await import("@/lib/offline/submit");
        const result = await submitQueued(kind, path, body);
        toast.success(result.queued ? "Guardado en este dispositivo. Se sincroniza al volver la red." : message);
      } else {
        await apiSend(path, "POST", body);
        toast.success(message);
      }
      await queryClient.invalidateQueries({ queryKey: ["reparto"] });
      await queryClient.invalidateQueries({ queryKey: ["estacion-tanques"] });
    } catch (error) {
      if (error instanceof ApiError && error.message.includes("litros en el camión")) {
        setAskClose(true);
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "No se pudo");
    }
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <Dialog open={Boolean(mermaAsk)} onOpenChange={(open) => { if (!open) setMermaAsk(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merma alta</DialogTitle></DialogHeader>
          <p className="text-sm">{mermaAsk?.text}</p>
          <div className="flex gap-2">
            <Button onClick={() => { const run = mermaAsk?.run; setMermaAsk(null); run?.(); }}>Confirmar</Button>
            <Button variant="outline" onClick={() => setMermaAsk(null)}>Cancelar</Button>
          </div>
        </DialogContent>
      </Dialog>
      <div>
        <h1 className="text-3xl tracking-tight sm:text-4xl">Reparto a granel</h1>
        <p className="text-sm text-muted-foreground">Camiones propios: se cargan desde el tanque, entregan en ruta y devuelven el sobrante.</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {(board?.trucks ?? []).map((truck) => (
          <li key={truck.id} className="rounded-xl border bg-card p-4 text-sm">
            <p className="font-semibold">{truck.plate} · {truck.name}</p>
            {(board?.compartments ?? []).filter((item) => item.truck_id === truck.id).map((item) => (
              <p key={item.id} className="text-muted-foreground">{item.name} · {item.product_name} · {formatMeasure(Number(item.quantity), "litro")} / {formatMeasure(Number(item.capacity), "litro")}</p>
            ))}
          </li>
        ))}
      </ul>
      {board?.canCreate ? (
        <div className="grid gap-2 rounded-xl border bg-card p-4">
          {!trip ? (
            <div className="flex flex-wrap gap-2">
              <select className="h-8 rounded-lg border px-2 text-sm" value={truckId} onChange={(event) => setTruckId(event.target.value)}>
                <option value="">Camión</option>
                {(board?.trucks ?? []).map((truck) => <option key={truck.id} value={truck.id}>{truck.plate}</option>)}
              </select>
              <Input className="w-36" placeholder="Km de salida" value={km} onChange={(event) => setKm(event.target.value)} />
              <Button onClick={() => {
                if (!truckId) { toast.error("Elegí un camión"); return; }
                const kmStart = km ? parseLocaleNumber(km) : null;
                if (km && kmStart == null) { toast.error("El kilometraje tiene que ser un número"); return; }
                return void send("/api/reparto/viaje", { truckId, ...(kmStart != null ? { kmStart } : {}) }, "Hoja de ruta abierta");
              }}>Abrir viaje</Button>
            </div>
          ) : (
            <>
              <p className="text-sm">Viaje de {trip.driver_name} · km {trip.km_start ? formatQty(Number(trip.km_start)) : "s/d"}</p>
              <div className="flex flex-wrap gap-2">
                <select className="h-8 rounded-lg border px-2 text-sm" value={compartmentId} onChange={(event) => setCompartmentId(event.target.value)}>
                  <option value="">Compartimento</option>
                  {compartments.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.product_name}</option>)}
                </select>
                <select className="h-8 rounded-lg border px-2 text-sm" value={tankId} onChange={(event) => setTankId(event.target.value)}>
                  <option value="">Tanque</option>
                  {(board?.tanks ?? []).map((tank) => <option key={tank.id} value={tank.id}>{tank.name}{tank.capacity ? ` · ${formatQty(Number(tank.capacity))}` : ""}</option>)}
                </select>
                <Input className="w-24" value={liters} onChange={(event) => setLiters(event.target.value)} />
                <Button variant="outline" onClick={() => {
                  if (!compartmentId) { toast.error("Elegí el compartimento"); return; }
                  const qty = parseLocaleNumber(liters);
                  if (qty == null || qty <= 0) { toast.error("La cantidad tiene que ser mayor a cero"); return; }
                  return void send("/api/reparto/viaje/carga", { tripId: trip.id, compartmentId, tankId, liters: qty }, "Carga anotada");
                }}>Cargar desde tanque</Button>
                <select className="h-8 rounded-lg border px-2 text-sm" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Cliente</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
                <select className="h-8 rounded-lg border px-2 text-sm" value={documentKind} onChange={(event) => setDocumentKind(event.target.value as "remito" | "factura")}>
                  <option value="remito">Remito</option>
                  <option value="factura">Factura</option>
                </select>
                <Button variant="outline" onClick={() => {
                  if (!compartmentId) { toast.error("Elegí el compartimento"); return; }
                  if (!customerId) { toast.error("Elegí el cliente"); return; }
                  const qty = parseLocaleNumber(liters);
                  if (qty == null || qty <= 0) { toast.error("La cantidad tiene que ser mayor a cero"); return; }
                  return void send("/api/reparto/viaje/entrega", { tripId: trip.id, compartmentId, customerId, liters: qty, document: documentKind, partyName: customers.find((customer) => customer.id === customerId)?.name, issuedOn: todayIso(), lines: [{ description: "Entrega en ruta", quantity: qty, totalCents: 0 }] }, "Entrega anotada");
                }}>Entregar</Button>
                <Button variant="outline" onClick={() => {
                  if (!compartmentId) { toast.error("Elegí el compartimento"); return; }
                  const qty = parseLocaleNumber(liters);
                  if (qty == null || qty <= 0) { toast.error("La cantidad tiene que ser mayor a cero"); return; }
                  const left = (board?.compartments ?? []).filter((item) => item.truck_id === trip.truck_id).reduce((sum, item) => sum + Number(item.quantity), 0);
                  const loaded = (board?.events ?? []).filter((item) => item.trip_id === trip.id && item.kind === "carga").reduce((sum, item) => sum + Number(item.liters ?? 0), 0);
                  const merma = Math.max(0, left - qty);
                  const devolver = () => void send("/api/reparto/viaje/retorno", { tripId: trip.id, compartmentId, tankId, liters: qty }, "Sobrante devuelto");
                  if (loaded > 0 && merma > loaded * 0.05) {
                    setMermaAsk({ text: `Después de devolver quedan ${formatMeasure(merma, "litro")} de merma sobre una carga de ${formatMeasure(loaded, "litro")}, más del 5%. ¿La devolvés igual?`, run: devolver });
                    return;
                  }
                  devolver();
                }}>Devolver sobrante</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-xs" aria-label="Concepto" placeholder="Concepto" value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} />
                <Input className="w-32" aria-label="Importe" placeholder="Importe" value={expense} onChange={(event) => setExpense(event.target.value)} />
                <Button variant="outline" onClick={() => {
                  const amountCents = parseMoneyToCents(expense);
                  if (!expenseNote.trim()) { toast.error("Poné el concepto"); return; }
                  if (amountCents == null || amountCents <= 0) { toast.error("El importe tiene que ser mayor a cero"); return; }
                  return void send("/api/reparto/viaje/gasto", { tripId: trip.id, amountCents, note: expenseNote.trim() }, "Gasto anotado").then(() => { setExpense(""); setExpenseNote(""); });
                }}>Anotar gasto</Button>
                <Input className="w-36" placeholder="Km de cierre" value={kmEnd} onChange={(event) => setKmEnd(event.target.value)} />
                <Button onClick={() => {
                  if (!kmEnd.trim()) { toast.error("Anotá los kilómetros de cierre"); return; }
                  const end = parseLocaleNumber(kmEnd);
                  if (end == null) { toast.error("El kilometraje tiene que ser un número"); return; }
                  const start = trip.km_start == null ? null : Number(trip.km_start);
                  if (start != null && end < start) { toast.error("El kilometraje de cierre no puede ser menor que el de salida"); return; }
                  return void send("/api/reparto/viaje/cerrar", { tripId: trip.id, kmEnd: end }, "Viaje cerrado");
                }}>Cerrar viaje</Button>
                {askClose ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Quedan litros en el camión.</span>
                    <Button variant="outline" onClick={() => void send("/api/reparto/viaje/devolver", { tripId: trip.id }, "Sobrante devuelto al tanque. El viaje sigue abierto.").then(() => setAskClose(false))}>Devolver al tanque</Button>
                    <Button variant="outline" onClick={() => {
                      const left = (board?.compartments ?? []).filter((item) => item.truck_id === trip.truck_id).reduce((sum, item) => sum + Number(item.quantity), 0);
                      const loaded = (board?.events ?? []).filter((item) => item.trip_id === trip.id && item.kind === "carga").reduce((sum, item) => sum + Number(item.liters ?? 0), 0);
                      if (loaded > 0 && left > loaded * 0.05) {
                        const end = kmEnd ? parseLocaleNumber(kmEnd) : null;
                        setMermaAsk({
                          text: `La merma es ${formatMeasure(left, "litro")} sobre una carga de ${formatMeasure(loaded, "litro")}, más del 5%. ¿La anotás igual?`,
                          run: () => void send("/api/reparto/viaje/cerrar", { tripId: trip.id, disposition: "merma", ...(end != null ? { kmEnd: end } : {}) }, "Viaje cerrado con merma").then(() => setAskClose(false)),
                        });
                        return;
                      }
                      const end = kmEnd ? parseLocaleNumber(kmEnd) : null;
                      void send("/api/reparto/viaje/cerrar", { tripId: trip.id, disposition: "merma", ...(end != null ? { kmEnd: end } : {}) }, "Viaje cerrado con merma").then(() => setAskClose(false));
                    }}>Anotar merma</Button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {board?.canCreate || board?.canEdit ? (
        <div className="flex flex-wrap gap-2">
          {board?.canCreate ? <Button variant="outline" onClick={() => void emitir("remito")}>Remito de entregas pendientes</Button> : null}
          {board?.canEdit ? <Button onClick={() => void emitir("factura")}>Factura de entregas pendientes</Button> : null}
        </div>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {(board?.events ?? []).filter((event) => trip && event.trip_id === trip.id).slice(0, 12).map((event) => (
          <li key={event.id} className="flex justify-between px-4 py-2">
            <span>{event.kind === "carga" ? "Carga" : event.kind === "entrega" ? "Entrega" : event.kind === "retorno" ? "Retorno" : event.kind === "gasto" ? "Gasto" : event.kind === "merma" ? "Merma" : event.kind}{event.note ? ` · ${event.note}` : ""}{event.kind === "entrega" && !event.document_id ? " · sin comprobante" : ""}</span>
            <span>{event.liters ? formatMeasure(Number(event.liters), "litro") : event.amount_cents ? formatMoney(Number(event.amount_cents)) : ""}</span>
          </li>
        ))}
      </ul>
      <div className="overflow-auto rounded-xl border bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr><th className="p-2 text-left">Camión</th><th className="p-2 text-left">Chofer</th><th className="p-2 text-left">Entregado</th><th className="p-2 text-left">Gastos</th><th className="p-2 text-left">Merma</th></tr></thead>
          <tbody>
            {(board?.summary ?? []).map((row) => (
              <tr key={`${row.truck}-${row.driver}`} className="border-t">
                <td className="p-2">{row.truck}</td>
                <td className="p-2">{row.driver}</td>
                <td className="p-2">{formatMeasure(Number(row.liters), "litro")}</td>
                <td className="p-2">{formatMoney(Number(row.expenses))}</td>
                <td className="p-2">{formatMeasure(Number(row.shrinkage), "litro")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {board && board.summary.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Todavía no hay viajes para resumir.</p> : null}
      </div>
    </div>
  );
}
