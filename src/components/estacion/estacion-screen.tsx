"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { estacionTabs } from "@/lib/auth/access";
import { fuelShown, litersSold, shiftBoard, splitPumpSale } from "@/lib/estacion/calc";
import { queuedFleetVouchers, reconcileFleetVouchers, resolveFleetVehicle, valeFormError, type ProvisionalReceipt } from "@/lib/offline/engine";
import { cajaDifferenceText, formatDateTime, formatMeasure, formatMoney, formatQty, parseDbNumber, parseLocaleNumber, parseMoneyToCents, paymentLabel, signedMoney, todayIso } from "@/lib/format";
import { useBrowserReady, readRetryPayload } from "@/components/use-browser-ready";
import { useCachedMe, useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Equipos } from "@/components/estacion/equipos-screen";

type Product = { id: string; name: string; code: string; unit: string; iva_rate_bps: number; priceCents: number | null; taxes: { code: string; name: string; centsPerUnit: number; inVatBase: boolean; treatment: "interno" | "no_gravado" }[] };
type Nozzle = { id: string; number: number; pump_name: string; product_id: string; product_name: string; tank_name: string; last_closing: string | null };
type Article = { id: string; sku: string; name: string; price_cents: string | null };
type ShiftRow = { id: string; attendant_id?: string | null; attendant_name: string; status: string; opened_at: string; fuel_cents?: string; shop_cents?: string; collected_cents?: string };
type Shift = ShiftRow & { attendant_id: string | null; invoiced_cents: string; readings: { nozzle_id: string; opening: string; closing: string | null; liters: string; amount_cents: string }[]; payments: { method: string; amount_cents: string }[]; shop: { description: string; amount_cents: string }[] };
type StationBoard = { canEdit: boolean; canCreate: boolean; products: Product[]; articles: Article[]; attendants: { id: string; name: string }[]; nozzles: Nozzle[]; shifts: ShiftRow[]; shift: Shift | null };

const STATION_BOARD_KEY = "talon-estacion-board";

function readStationBoard(): StationBoard | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = localStorage.getItem(STATION_BOARD_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StationBoard;
  } catch {
    return undefined;
  }
}

function closingShown(typed: string | undefined, saved: string | null | undefined) {
  if (typed) return typed;
  if (saved == null || saved === "") return "";
  return formatQty(parseDbNumber(saved));
}

async function sendPlay(kind: "turno" | "aforadores" | "shop" | "cobro" | "vale" | "comprobante", path: string, payload: Record<string, unknown>) {
  const { submitQueued } = await import("@/lib/offline/submit");
  return submitQueued(kind, path, payload);
}

export function EstacionScreen({ initialTab = "playa" }: { initialTab?: string }) {
  const me = useMe();
  const cached = useCachedMe();
  const actor = me.data ?? cached;
  const companyId = actor?.company.id;
  const canStation = Boolean(actor?.company.modules?.includes("estacion") && actor.permissions.some((permission) => permission.startsWith("estacion.")));
  const queryClient = useQueryClient();
  const playa = useQuery({
    queryKey: ["estacion", companyId],
    enabled: Boolean(companyId) && canStation,
    staleTime: 20_000,
    networkMode: "offlineFirst",
    placeholderData: readStationBoard,
    queryFn: async () => {
      try {
        const fresh = await apiGet<StationBoard>(`/api/estacion`);
        localStorage.setItem(STATION_BOARD_KEY, JSON.stringify(fresh));
        return fresh;
      } catch (error) {
        const saved = readStationBoard();
        if (saved && (typeof navigator === "undefined" || navigator.onLine === false || error instanceof TypeError)) return saved;
        throw error;
      }
    },
  });
  const [editedClosings, setClosings] = useState<Record<string, string>>({});
  const [payments, setPayments] = useState({ efectivo: "", tarjeta: "", qr: "", cuenta_corriente: "", vale: "" });
  const [invoiced, setInvoiced] = useState("");
  const [pendingSales, setPendingSales] = useState(0);
  const [shop, setShop] = useState({ productId: "", description: "", quantity: "1", amount: "" });
  const [attendantId, setAttendantId] = useState("");
  const [offlineShift, setOfflineShift] = useState<Shift | null>(null);
  const [dismissedShiftId, setDismissedShiftId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closePayload, setClosePayload] = useState<Record<string, unknown> | null>(null);
  const [closeGapText, setCloseGapText] = useState("");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["estacion"] });
  }

  async function openShift() {
    try {
      const id = crypto.randomUUID();
      const chosen = playa.data?.attendants.find((person) => person.id === attendantId);
      const result = await sendPlay("turno", "/api/estacion/turno", { id, attendantId: attendantId || undefined });
      if (result.queued) {
        setOfflineShift({
          id: String(result.payload.id),
          attendant_id: attendantId || me.data?.user.id || cached?.user.id || null,
          attendant_name: chosen?.name ?? me.data?.user.name ?? cached?.user.name ?? "Playero",
          status: "abierto",
          opened_at: new Date().toISOString(),
          invoiced_cents: "0",
          readings: (data?.nozzles ?? []).map((nozzle) => ({ nozzle_id: nozzle.id, opening: nozzle.last_closing ?? "0", closing: null, liters: "0", amount_cents: "0" })),
          payments: [],
          shop: [],
        });
        toast.success("Turno guardado en este dispositivo");
        return;
      }
      toast.success("Turno abierto");
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo abrir");
    }
  }

  const data = playa.data;
  const tabs = actor && canStation ? estacionTabs(actor.permissions) : ["playa"];
  const visibleShifts = (data?.shifts ?? []).filter((item) => data?.canEdit || item.attendant_id === actor?.user.id);
  const liveShift = data?.shift && data.shift.id !== dismissedShiftId ? data.shift : null;
  const shift = liveShift ?? (offlineShift && offlineShift.id !== dismissedShiftId ? offlineShift : null);
  const closings: Record<string, string> = {
    ...Object.fromEntries((shift?.readings ?? []).filter((reading) => reading.closing != null && reading.closing !== "").map((reading) => [reading.nozzle_id, formatQty(parseDbNumber(reading.closing!))])),
    ...editedClosings,
  };
  const rows = (data?.nozzles ?? []).map((nozzle) => {
    const reading = shift?.readings.find((item) => item.nozzle_id === nozzle.id);
    const opening = parseDbNumber(reading?.opening ?? nozzle.last_closing ?? 0);
    const closing = parseLocaleNumber(closings[nozzle.id] || reading?.closing || "") ?? 0;
    const product = data?.products.find((item) => item.id === nozzle.product_id);
    let liters = 0;
    let amount = 0;
    let error = "";
    if (closing > 0) {
      try {
        liters = litersSold(opening, closing);
        amount = Math.round(liters * (product?.priceCents ?? 0));
      } catch (reason) {
        error = reason instanceof Error ? reason.message : "Aforador inválido";
      }
    }
    return { nozzle, opening, liters, amount, error, product };
  });
  const typing = rows.some((row) => closings[row.nozzle.id]);
  const liveFuel = rows.reduce((sum, row) => sum + row.amount, 0);
  const savedFuel = (shift?.readings ?? []).reduce((sum, reading) => sum + Number(reading.amount_cents || 0), 0);
  const fuelCents = fuelShown(liveFuel, savedFuel, typing);
  const shopCents = (shift?.shop ?? []).reduce((sum, line) => sum + Number(line.amount_cents), 0);
  const collected = Object.values(payments).reduce((sum, value) => sum + (parseMoneyToCents(value) ?? 0), 0);
  const paymentsEntered = Object.values(payments).some((value) => (parseMoneyToCents(value) ?? 0) > 0);
  const gap = shiftBoard({ fuelCents, shopCents, collectedCents: collected, invoicedCents: parseMoneyToCents(invoiced) ?? 0, paymentsEntered });

  useEffect(() => {
    const load = () => {
      void import("@/lib/offline/submit").then(async (mod) => setPendingSales(await mod.pendingSaleCents()));
    };
    load();
    window.addEventListener("talon-outbox", load);
    return () => window.removeEventListener("talon-outbox", load);
  }, []);

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cerrar el turno con diferencia</DialogTitle></DialogHeader>
          <p className="text-sm">{closeGapText} ¿Confirmás el cierre?</p>
          <div className="flex gap-2">
            <Button onClick={() => {
              if (!closePayload) return;
              setConfirmClose(false);
              void sendPlay("cobro", "/api/estacion/turno/cerrar", closePayload).then(async (result) => {
                toast.success(result.queued ? "Cobro guardado en este dispositivo" : "Turno cerrado");
                setDismissedShiftId(String(closePayload.shiftId));
                setPayments({ efectivo: "", tarjeta: "", qr: "", cuenta_corriente: "", vale: "" });
                setInvoiced("");
                setClosings({});
                setOfflineShift(null);
                if (!result.queued) await refresh();
              }).catch((error) => toast.error(error.message));
            }}>Cerrar igual</Button>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>Volver</Button>
          </div>
        </DialogContent>
      </Dialog>
      <div>
        <h1 className="text-4xl tracking-tight">Estación de servicio</h1>
        <p className="text-sm text-muted-foreground">Playas, tanques y flota. Los impuestos del combustible se parametrizan por producto.</p>
      </div>
      <Tabs defaultValue={tabs.includes(initialTab) ? initialTab : "playa"}>
        <TabsList className="flex h-auto flex-wrap">
          {tabs.includes("playa") ? <TabsTrigger value="playa">Playa</TabsTrigger> : null}
          {tabs.includes("tanques") ? <TabsTrigger value="tanques">Tanques</TabsTrigger> : null}
          {tabs.includes("precios") ? <TabsTrigger value="precios">Precios</TabsTrigger> : null}
          {tabs.includes("flota") ? <TabsTrigger value="flota">Flota</TabsTrigger> : null}
          {tabs.includes("equipos") ? <TabsTrigger value="equipos">Equipos</TabsTrigger> : null}
          {tabs.includes("informes") ? <TabsTrigger value="informes">Informes</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="playa" className="grid gap-4">
          {!shift && data?.canCreate ? (
            <div className="flex flex-wrap gap-2">
              {data.canEdit && data.attendants?.length ? (
                <select className="h-8 rounded-lg border px-2 text-sm" value={attendantId} onChange={(event) => setAttendantId(event.target.value)}>
                  <option value="">Yo</option>
                  {data.attendants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              ) : null}
              <Button onClick={() => void openShift()}>{attendantId ? "Abrir turno del playero" : "Abrir mi turno"}</Button>
            </div>
          ) : null}
          {shift ? (
            <>
              <p className="text-sm">Turno de {shift.attendant_name}</p>
              <div className="overflow-auto rounded-xl border bg-card">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/70 text-left">
                    <tr>
                      <th className="px-3 py-2">Pico</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Inicio</th>
                      <th className="px-3 py-2">Cierre</th>
                      <th className="px-3 py-2">Litros</th>
                      <th className="px-3 py-2">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.nozzle.id} className="border-t">
                        <td className="px-3 py-2">{row.nozzle.pump_name} · {row.nozzle.number}</td>
                        <td className="px-3 py-2">{row.nozzle.product_name}</td>
                        <td className="px-3 py-2">{formatQty(row.opening)}</td>
                        <td className="px-3 py-2">
                          <Input className="w-28" aria-label={`Cierre ${row.nozzle.pump_name} ${row.nozzle.number}`} value={closingShown(closings[row.nozzle.id], shift?.readings.find((item) => item.nozzle_id === row.nozzle.id)?.closing)} onChange={(event) => setClosings({ ...closings, [row.nozzle.id]: event.target.value })} />
                        </td>
                        <td className="px-3 py-2">{row.error || formatMeasure(row.liters, row.product?.unit ?? "litro")}</td>
                        <td className="px-3 py-2">{formatMoney(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 md:grid-cols-5">
                {(["efectivo", "tarjeta", "qr", "cuenta_corriente", "vale"] as const).map((method) => (
                  <label key={method} className="grid gap-1 text-sm">
                    {paymentLabel(method)}
                    <Input value={payments[method]} onChange={(event) => setPayments({ ...payments, [method]: event.target.value })} />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <select className="h-8 rounded-lg border px-2 text-sm" value={shop.productId} onChange={(event) => {
                  const article = data?.articles.find((item) => item.id === event.target.value);
                  setShop({
                    productId: event.target.value,
                    description: article?.name ?? shop.description,
                    quantity: shop.quantity,
                    amount: article?.price_cents ? String(Number(article.price_cents) / 100) : shop.amount,
                  });
                }}>
                  <option value="">Artículo del shop</option>
                  {(data?.articles ?? []).map((article) => <option key={article.id} value={article.id}>{article.name}</option>)}
                </select>
                <Input className="max-w-xs" placeholder="Descripción" value={shop.description} onChange={(event) => setShop({ ...shop, description: event.target.value })} />
                <Input className="w-24" placeholder="Importe" value={shop.amount} onChange={(event) => setShop({ ...shop, amount: event.target.value })} />
                <Button variant="outline" onClick={() => {
                  const quantity = parseLocaleNumber(shop.quantity);
                  const amountCents = parseMoneyToCents(shop.amount);
                  if (!shop.productId) { toast.error("Elegí un artículo del shop"); return; }
                  if (quantity == null || quantity <= 0) { toast.error("La cantidad tiene que ser mayor a cero"); return; }
                  if (amountCents == null || amountCents <= 0) { toast.error("El importe del shop tiene que ser mayor a cero"); return; }
                  return void sendPlay("shop", "/api/estacion/turno/shop", { shiftId: shift.id, productId: shop.productId, description: shop.description || "Shop", quantity, amountCents }).then(async (result) => { if (result.queued) toast.success("Shop guardado en este dispositivo"); else { toast.success("Shop sumado"); setShop({ ...shop, description: "", quantity: "1", amount: "" }); await refresh(); } }).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo sumar"));
                }}>
                  Sumar shop
                </Button>
              </div>
              <label className="grid max-w-xs gap-1 text-sm">
                Facturado en el turno
                <Input value={invoiced} onChange={(event) => setInvoiced(event.target.value)} />
              </label>
              <p className="text-sm">
                Vendido {formatMoney(gap.soldCents + pendingSales)}.{pendingSales ? ` ${formatMoney(pendingSales)} pendiente de sincronizar.` : ""}
                {gap.collectedDifference == null ? " Cargá los medios de pago para ver la diferencia de caja." : ` ${cajaDifferenceText(gap.soldCents, collected)}.`}
                {gap.invoiceDifference == null ? "" : ` Contra lo facturado ${formatMoney(gap.invoiceDifference)}.`}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  const readings = rows.flatMap((row) => {
                    const raw = closings[row.nozzle.id];
                    if (!raw) return [];
                    const closing = parseLocaleNumber(raw);
                    return closing == null ? [{ invalid: true, nozzleId: row.nozzle.id, closing: 0 }] : [{ invalid: false, nozzleId: row.nozzle.id, closing }];
                  });
                  if (readings.some((reading) => reading.invalid)) { toast.error("El aforador tiene que ser un número"); return; }
                  return void sendPlay("aforadores", "/api/estacion/turno/aforadores", { shiftId: shift.id, readings: readings.map(({ nozzleId, closing }) => ({ nozzleId, closing })) }).then(async (result) => { toast.success(result.queued ? "Aforadores guardados en este dispositivo" : "Aforadores guardados"); if (!result.queued) await refresh(); }).catch((error) => toast.error(error.message));
                }}>
                  Guardar aforadores
                </Button>
                <Button onClick={() => {
                  const pending: { nozzleId: string; closing: number }[] = [];
                  for (const row of rows) {
                    const raw = closings[row.nozzle.id];
                    if (!raw) continue;
                    const closing = parseLocaleNumber(raw);
                    if (closing == null) { toast.error("Hay un aforador sin guardar que no es un número"); return; }
                    pending.push({ nozzleId: row.nozzle.id, closing });
                  }
                  const payload = {
                  shiftId: shift.id,
                  invoicedCents: parseMoneyToCents(invoiced) ?? 0,
                  readings: pending,
                  payments: (["efectivo", "tarjeta", "qr", "cuenta_corriente", "vale"] as const).flatMap((method) => {
                    const amountCents = parseMoneyToCents(payments[method]) ?? 0;
                    return amountCents > 0 ? [{ method, amountCents }] : [];
                  }),
                };
                  if (gap.collectedDifference != null && gap.collectedDifference !== 0) { setClosePayload(payload); setCloseGapText(cajaDifferenceText(gap.soldCents, collected)); setConfirmClose(true); return; }
                  return void sendPlay("cobro", "/api/estacion/turno/cerrar", payload).then(async (result) => {
                  toast.success(result.queued ? "Cobro guardado en este dispositivo" : "Turno cerrado");
                  setDismissedShiftId(shift.id);
                  setPayments({ efectivo: "", tarjeta: "", qr: "", cuenta_corriente: "", vale: "" });
                  setInvoiced("");
                  setClosings({});
                  setOfflineShift(null);
                  if (!result.queued) await refresh();
                }).catch((error) => toast.error(error.message));
                }}>
                  Cerrar turno
                </Button>
              </div>
              {rows[0]?.product?.priceCents ? <TaxHint product={rows[0].product} liters={rows[0].liters || 1} /> : null}
            </>
          ) : <p className="text-sm text-muted-foreground">No hay un turno abierto. Los turnos cerrados quedan abajo.</p>}
          {visibleShifts.length ? (
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {visibleShifts.filter((item) => item.status === "cerrado").map((item) => {
                const sold = Number(item.fuel_cents ?? 0) + Number(item.shop_cents ?? 0);
                const collected = Number(item.collected_cents ?? 0);
                return (
                <li key={item.id} className="flex justify-between gap-3 px-4 py-2">
                  <span>{item.attendant_name}</span>
                  <span className="text-muted-foreground">{formatDateTime(item.opened_at)} · total {formatMoney(sold)} · diferencia {signedMoney(collected - sold)}</span>
                </li>
                );
              })}
            </ul>
          ) : null}
        </TabsContent>
        {tabs.includes("tanques") ? <TabsContent value="tanques"><Tanks /></TabsContent> : null}
        {tabs.includes("precios") ? <TabsContent value="precios"><Prices /></TabsContent> : null}
        {tabs.includes("flota") ? <TabsContent value="flota"><Fleet /></TabsContent> : null}
        {tabs.includes("equipos") ? <TabsContent value="equipos"><Equipos /></TabsContent> : null}
        {tabs.includes("informes") ? <TabsContent value="informes"><Reports /></TabsContent> : null}
      </Tabs>
    </div>
  );
}

function TaxHint({ product, liters }: { product: Product; liters: number }) {
  if (!product.priceCents) return null;
  const split = splitPumpSale({ quantity: liters, pumpPriceCents: product.priceCents, ivaRateBps: product.iva_rate_bps, taxes: product.taxes });
  return (
    <p className="text-sm text-muted-foreground">
      En {product.name}, {formatMeasure(liters, product.unit)}: base IVA {formatMoney(split.vatBaseCents)}, IVA {formatMoney(split.vatCents)}, impuestos {formatMoney(split.taxCents)}.
    </p>
  );
}

function Tanks() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["estacion-tanques"], queryFn: () => apiGet<{ canEdit: boolean; deliveries: { tank_id: string; liters: string; supplier_name: string }[]; tanks: { id: string; name: string; product_name: string; unit: string; capacity: string; deliveryLiters?: number; soldLiters?: number; reconciliation: { theoretical: number; variance: number; shrinkage: number } | null; current: { liters: string } | null }[] }>("/api/estacion/tanques") });
  const [tankId, setTankId] = useState("");
  const [stickLiters, setStickLiters] = useState("");
  const [dropLiters, setDropLiters] = useState("");
  const [supplier, setSupplier] = useState("Combustibles del Litoral");
  async function send(path: string, raw: string) {
    try {
      const measured = parseLocaleNumber(raw);
      if (!tankId) { toast.error("Elegí un tanque"); return; }
      if (path.endsWith("medicion") && raw.trim() === "") { toast.error("Anotá los litros. 0 vale si el tanque está vacío."); return; }
      if (measured == null) { toast.error("La cantidad tiene que ser un número"); return; }
      if (path.endsWith("medicion") && measured < 0) { toast.error("La varilla no puede ser negativa. 0 es un tanque vacío."); return; }
      if (path.endsWith("descarga") && measured <= 0) { toast.error("La descarga tiene que ser mayor a cero"); return; }
      await apiSend(path, "POST", { tankId, liters: measured, supplierName: supplier, note: path.endsWith("medicion") ? "Medición de playa" : "Descarga" });
      toast.success(path.endsWith("medicion") ? "Varilla anotada" : "Descarga anotada");
      if (path.endsWith("medicion")) setStickLiters("");
      else setDropLiters("");
      await queryClient.invalidateQueries({ queryKey: ["estacion-tanques"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo anotar");
    }
  }
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-xl border bg-card">
        {(data.data?.tanks ?? []).map((tank) => (
          <li key={tank.id} className="px-4 py-3 text-sm">
            <button type="button" className="font-semibold" onClick={() => setTankId(tank.id)}>{tank.name}</button>
            <span className="text-muted-foreground"> · {tank.product_name} · capacidad {formatMeasure(Number(tank.capacity), tank.unit)}</span>
            {tank.reconciliation ? <p>Entre las dos últimas varillas: teórico {formatMeasure(tank.reconciliation.theoretical, tank.unit)} (descargas {formatMeasure(tank.deliveryLiters ?? 0, tank.unit)}, ventas y camiones {formatMeasure(tank.soldLiters ?? 0, tank.unit)}) · diferencia {formatMeasure(tank.reconciliation.variance, tank.unit)} · merma {formatMeasure(tank.reconciliation.shrinkage, tank.unit)}</p> : tank.current ? <p>Medido {formatMeasure(parseDbNumber(tank.current.liters), tank.unit)}. Con la próxima varilla se concilia contra esta.</p> : <p>Hace falta una medición para empezar a conciliar.</p>}
            {(data.data?.deliveries ?? []).filter((item) => item.tank_id === tank.id).slice(-3).map((item) => (
              <p key={`${item.supplier_name}-${item.liters}`} className="text-muted-foreground">Descarga {formatMeasure(Number(item.liters), tank.unit)} · {item.supplier_name}</p>
            ))}
          </li>
        ))}
      </ul>
      {data.data?.canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" aria-label="Litros de varilla" placeholder="Litros medidos" value={stickLiters} onChange={(event) => setStickLiters(event.target.value)} />
          <Button variant="outline" onClick={() => void send("/api/estacion/tanques/medicion", stickLiters)}>Varillar</Button>
          <Input className="max-w-xs" aria-label="Litros de descarga" placeholder="Litros descargados" value={dropLiters} onChange={(event) => setDropLiters(event.target.value)} />
          <Input className="max-w-xs" aria-label="Proveedor de la descarga" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
          <Button onClick={() => void send("/api/estacion/tanques/descarga", dropLiters)}>Descarga</Button>
        </div>
      ) : null}
    </div>
  );
}

function Prices() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["estacion-precios"], queryFn: () => apiGet<{ canEdit: boolean; products: Product[] }>("/api/estacion/precios") });
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [itc, setItc] = useState("");
  const [co2, setCo2] = useState("");
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-xl border bg-card">
        {(data.data?.products ?? []).map((product) => (
          <li key={product.id} className="px-4 py-3 text-sm">
            <p className="font-semibold">{product.name} · {product.priceCents ? formatMoney(product.priceCents) : "sin precio"} / {product.unit}</p>
            <p className="text-muted-foreground">{product.taxes.map((tax) => `${tax.name} ${formatMoney(tax.centsPerUnit)} (${tax.treatment}, ${tax.inVatBase ? "dentro" : "fuera"} de la base de IVA)`).join(" · ")}</p>
          </li>
        ))}
      </ul>
      {data.data?.canEdit ? (
        <form noValidate className="flex flex-wrap gap-2" onSubmit={async (event) => {
          event.preventDefault();
          if (!productId) { toast.error("Elegí el combustible"); return; }
          try {
            const product = data.data?.products.find((item) => item.id === productId);
            const cents = parseMoneyToCents(price);
            if (cents == null || cents <= 0) { toast.error("El precio tiene que ser un número"); return; }
            const taxes = product && (itc || co2) ? [
              { code: "itc", name: "ITC", centsPerUnit: parseMoneyToCents(itc) ?? 0, treatment: product.taxes.find((tax) => tax.code === "itc")?.treatment ?? "interno", inVatBase: product.taxes.find((tax) => tax.code === "itc")?.inVatBase ?? false },
              { code: "co2", name: "Impuesto al CO2", centsPerUnit: parseMoneyToCents(co2) ?? 0, treatment: product.taxes.find((tax) => tax.code === "co2")?.treatment ?? "no_gravado", inVatBase: product.taxes.find((tax) => tax.code === "co2")?.inVatBase ?? false },
            ] : undefined;
            await apiSend("/api/estacion/precios", "POST", { productId, cents, taxes });
            toast.success("Precio vigente desde ahora");
            await queryClient.invalidateQueries({ queryKey: ["estacion-precios"] });
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "No se pudo cambiar");
          }
        }}>
          <select className="h-8 rounded-lg border px-2 text-sm" value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Producto</option>
            {(data.data?.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <Input className="w-32" placeholder="Precio" value={price} onChange={(event) => setPrice(event.target.value)} />
          <Input className="w-28" placeholder="ITC / unidad" value={itc} onChange={(event) => setItc(event.target.value)} />
          <Input className="w-28" placeholder="CO2 / unidad" value={co2} onChange={(event) => setCo2(event.target.value)} />
          <Button type="submit">Cambiar precio</Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">El playero no cambia precios.</p>}
    </div>
  );
}

type FleetClients = { customers: { id: string; name: string }[]; vehicles: { id: string; customer_id: string; plate: string; limit_cents: string | null }[]; drivers: { id: string; customer_id: string; name: string }[] };
type FleetBoard = { canEdit: boolean; canCreate: boolean; customers: { id: string; name: string }[]; vehicles: FleetClients["vehicles"]; drivers: FleetClients["drivers"]; vouchers: { id: string; customer_id: string; liters: string; amount_cents: string; status: string; product: string; unit: string; plate: string | null }[]; products: Product[] };

function Fleet() {
  const ready = useBrowserReady();
  return ready ? <FleetForm /> : <p className="p-4 text-sm">Abriendo flota…</p>;
}

function FleetForm() {
  const [retry] = useState(() => readRetryPayload("vale"));
  const queryClient = useQueryClient();
  const [confirmAll, setConfirmAll] = useState(false);
  const inflightLocals = useRef(new Set<string>());
  const clients = useQuery({
    queryKey: ["estacion-flota-clientes"],
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    queryFn: () => apiGet<FleetClients>("/api/estacion/flota-clientes"),
  });
  const data = useQuery({
    queryKey: ["estacion-flota"],
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    queryFn: async () => {
      try {
        const fresh = await apiGet<FleetBoard>("/api/estacion/flota");
        const { pendingOperations, offlineScope } = await import("@/lib/offline/submit");
        const pending = queuedFleetVouchers(await pendingOperations(), offlineScope(), fresh.products);
        const previous = queryClient.getQueryData<FleetBoard>(["estacion-flota"]);
        const live = new Set([...pending.map((item) => item.id), ...inflightLocals.current]);
        return { ...fresh, vouchers: reconcileFleetVouchers(fresh.vouchers, [...pending, ...(previous?.vouchers ?? [])], live) };
      } catch (error) {
        const previous = queryClient.getQueryData<FleetBoard>(["estacion-flota"]);
        if (previous?.vouchers.length) throw error;
        const { cachedReference, pendingOperations, offlineScope } = await import("@/lib/offline/submit");
        const cached = await cachedReference<{ customers: { id: string; name: string }[]; vehicles: { id: string; customer_id: string; plate: string }[]; fuel: { id: string; name: string; unit: string; price_cents: string | null }[]; vouchers: { id: string; customer_id: string; liters: string; amount_cents: string; customer: string }[] }>();
        if (!cached) throw error;
        return {
          canEdit: false,
          canCreate: true,
          customers: cached.customers ?? [],
          vehicles: (cached.vehicles ?? []).map((item) => ({ ...item, limit_cents: null })),
          drivers: [],
          vouchers: [
            ...queuedFleetVouchers(await pendingOperations(), offlineScope(), (cached.fuel ?? []).map((item) => ({ ...item }))),
            ...(cached.vouchers ?? []).map((item) => ({ ...item, status: "abierto", product: "", unit: "litro", plate: null })),
          ],
          products: (cached.fuel ?? []).map((item) => ({ id: item.id, name: item.name, code: "", unit: item.unit, iva_rate_bps: 2100, priceCents: item.price_cents ? Number(item.price_cents) : null, taxes: [] })),
        };
      }
    },
  });
  const fleetCustomers = unionById(clients.data?.customers, data.data?.customers);
  const fleetVehicles = unionById(clients.data?.vehicles, data.data?.vehicles);
  const fleetDrivers = unionById(clients.data?.drivers, data.data?.drivers);
  const [customerId, setCustomerId] = useState(String(retry?.customerId ?? ""));
  const [typedPlate, setPlate] = useState<string | null>(null);
  const [driver, setDriver] = useState("");
  const [chosenVehicleId, setVehicleId] = useState<string | null>(retry?.vehicleId ? String(retry.vehicleId) : null);
  const [chosenDriverId, setDriverId] = useState<string | null>(retry?.driverId ? String(retry.driverId) : null);
  const [liters, setLiters] = useState(String(retry?.liters ?? "20"));
  const [productId, setProductId] = useState(String(retry?.productId ?? ""));
  const [provisional, setProvisional] = useState<ProvisionalReceipt | null>(null);
  const customerVehicles = fleetVehicles.filter((item) => item.customer_id === customerId);
  const customerDrivers = fleetDrivers.filter((item) => item.customer_id === customerId);
  const vehicleId = chosenVehicleId ?? (customerVehicles.length === 1 ? customerVehicles[0].id : "");
  const plate = typedPlate ?? fleetVehicles.find((item) => item.id === vehicleId)?.plate ?? "";
  const driverId = chosenDriverId ?? (customerDrivers.length === 1 ? customerDrivers[0].id : "");

  function chooseCustomer(id: string) {
    setCustomerId(id);
    setPlate(null);
    setVehicleId(null);
    setDriverId(null);
  }

  const plateOptions = customerVehicles.length
    ? customerVehicles
    : fleetVehicles.filter((item) => plate.trim() && item.plate.replace(/[\s-]+/g, "").toUpperCase() === plate.replace(/[\s-]+/g, "").toUpperCase());

  function resetValeForm() {
    setCustomerId("");
    setPlate("");
    setVehicleId("");
    setDriver("");
    setDriverId("");
    setLiters("");
  }

  async function liveLocalIds() {
    const { pendingLocalIds } = await import("@/lib/offline/submit");
    return new Set([...(await pendingLocalIds("vale")), ...inflightLocals.current]);
  }

  useEffect(() => {
    const onOutbox = () => {
      void import("@/lib/offline/submit").then(async ({ pendingOperations, offlineScope }) => {
        const operations = await pendingOperations();
        const scope = offlineScope();
        const live = new Set([...operations.filter((op) => op.kind === "vale").map((op) => `local-${op.key}`), ...inflightLocals.current]);
        queryClient.setQueryData<FleetBoard>(["estacion-flota"], (current) => {
          if (!current) return current;
          const pending = queuedFleetVouchers(operations, scope, current.products);
          return { ...current, vouchers: reconcileFleetVouchers(current.vouchers, [...pending, ...current.vouchers], live) };
        });
      });
    };
    window.addEventListener("talon-outbox", onOutbox);
    const onReceipt = (event: Event) => {
      const detail = (event as CustomEvent<ProvisionalReceipt>).detail;
      if (detail?.fiscal === "provisorio") setProvisional(detail);
    };
    window.addEventListener("talon-receipt", onReceipt);
    return () => {
      window.removeEventListener("talon-outbox", onOutbox);
      window.removeEventListener("talon-receipt", onReceipt);
    };
  }, [queryClient]);

  useEffect(() => {
    if (retry) sessionStorage.removeItem("talon-retry-op");
  }, [retry]);
  return (
    <div className="grid gap-3">
      {provisional ? (
        <aside className="rounded-xl border bg-card p-4">
          <p className="font-semibold">Comprobante provisorio {provisional.localNumber}</p>
          <p className="text-sm text-muted-foreground">{provisional.partyName} · {provisional.issuedOn} · sin CAE, se numera al volver la red</p>
          <ul className="mt-2 text-sm">
            {provisional.lines.map((line) => (
              <li key={`${line.description}-${line.quantity}`} className="flex justify-between gap-3">
                <span>{line.description} · {formatQty(line.quantity)}</span>
                <span>{formatMoney(line.totalCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between text-sm font-semibold"><span>Total</span><span>{formatMoney(provisional.totalCents)}</span></p>
          <a className="mt-2 inline-block text-sm underline" href="/provisorio">Abrir el comprobante provisorio</a>
        </aside>
      ) : null}
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogHeader><DialogTitle>Facturar a todos</DialogTitle></DialogHeader>
          <p className="text-sm">Se emite un comprobante por cada cliente con vales abiertos.</p>
          <div className="flex gap-2">
            <Button onClick={() => {
              setConfirmAll(false);
              const open = (data.data?.vouchers ?? []).filter((voucher) => voucher.status === "abierto");
              const body = {
                from: "2026-01-01",
                to: "2026-12-31",
                issuedOn: todayIso(),
              };
              void apiSend("/api/estacion/flota/facturar", "POST", body).then(async () => {
                toast.success("Facturamos a todos los clientes con vales");
                await queryClient.invalidateQueries({ queryKey: ["estacion-flota"] });
              }).catch(async (error) => {
                if (error instanceof TypeError) {
                  const { submitQueued } = await import("@/lib/offline/submit");
                  await submitQueued("comprobante", "/api/estacion/flota/facturar", { ...body, partyName: "Clientes de flota", clientTotalCents: open.reduce((sum, voucher) => sum + Number(voucher.amount_cents), 0), lines: open.map((voucher) => ({ description: voucher.product, quantity: Number(voucher.liters), totalCents: Number(voucher.amount_cents) })) });
                  toast.success("Comprobante provisorio. Se numera al volver la red.");
                  return;
                }
                toast.error(error instanceof Error ? error.message : "No se pudo facturar");
              });
            }}>Facturar</Button>
            <Button variant="outline" onClick={() => setConfirmAll(false)}>Cancelar</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ul className="divide-y rounded-xl border bg-card">
        {(data.data?.vouchers ?? []).map((voucher) => (
          <li key={voucher.id} className="flex justify-between px-4 py-2 text-sm">
            <span>{voucher.product} · {voucher.plate ?? "sin patente"} · {formatMeasure(Number(voucher.liters), voucher.unit ?? "litro")}</span>
            <span>{voucher.id.startsWith("local-") ? "Pendiente de sincronizar" : voucher.status} · {formatMoney(Number(voucher.amount_cents))}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select className="h-8 rounded-lg border px-2 text-sm" value={customerId} onChange={(event) => chooseCustomer(event.target.value)}>
          <option value="">Cliente de flota</option>
          {fleetCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select>
        <Input className="w-32" placeholder="Patente" aria-label="Patente" value={plate} onChange={(event) => {
          const value = event.target.value;
                    setPlate(value);
          const match = resolveFleetVehicle(fleetVehicles, customerId, "", value);
          setVehicleId(match?.id ?? "");
        }} />
        {data.data?.canEdit ? <Button variant="outline" onClick={() => { if (!customerId) { toast.error("Elegí el cliente"); return; } void apiSend("/api/estacion/flota/vehiculo", "POST", { customerId, plate }).then(async () => { toast.success("Vehículo dado de alta"); setPlate(""); await queryClient.invalidateQueries({ queryKey: ["estacion-flota"] }); await queryClient.invalidateQueries({ queryKey: ["estacion-flota-clientes"] }); }).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo dar de alta")); }}>Alta de vehículo</Button> : null}
        <Input className="w-40" placeholder="Chofer" value={driver} onChange={(event) => setDriver(event.target.value)} />
        {data.data?.canEdit ? <Button variant="outline" onClick={() => { if (!customerId) { toast.error("Elegí el cliente"); return; } if (!driver.trim()) { toast.error("Poné el nombre del chofer"); return; } void apiSend("/api/estacion/flota/chofer", "POST", { customerId, name: driver }).then(async () => { toast.success("Chofer dado de alta"); setDriver(""); await queryClient.invalidateQueries({ queryKey: ["estacion-flota"] }); await queryClient.invalidateQueries({ queryKey: ["estacion-flota-clientes"] }); }).catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo dar de alta")); }}>Alta de chofer</Button> : null}
        <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Patente del vale" value={plateOptions.some((item) => item.id === vehicleId) ? vehicleId : ""} onChange={(event) => {
          const id = event.target.value;
                    setVehicleId(id);
          const vehicle = fleetVehicles.find((item) => item.id === id);
          if (vehicle) setPlate(vehicle.plate);
          else setPlate("");
        }}>
          <option value="">Patente</option>
          {plateOptions.map((item) => <option key={item.id} value={item.id}>{item.plate}</option>)}
        </select>
        <select className="h-8 rounded-lg border px-2 text-sm" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
          <option value="">Chofer del vale</option>
          {fleetDrivers.filter((item) => item.customer_id === customerId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="h-8 rounded-lg border px-2 text-sm" value={productId} onChange={(event) => setProductId(event.target.value)}>
          <option value="">Combustible</option>
          {(data.data?.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <Input className="w-24" value={liters} onChange={(event) => setLiters(event.target.value)} />
        <span className="self-center text-xs text-muted-foreground">El chofer del vale es opcional.</span>
        {data.data?.canCreate ? <Button variant="outline" onClick={() => {
          const qty = parseLocaleNumber(liters);
          const formError = valeFormError({ customerId, vehicleId, plate, liters: qty });
          if (formError || qty == null) { toast.error(formError ?? "La cantidad del vale tiene que ser mayor a cero"); return; }
          const product = (data.data?.products ?? []).find((item) => item.id === productId);
          const vehicle = resolveFleetVehicle(fleetVehicles, customerId, vehicleId, plate);
          const partyName = fleetCustomers.find((customer) => customer.id === customerId)?.name ?? "Consumidor final";
          const totalCents = Math.round(qty * (product?.priceCents ?? 0));
          const payload = {
            customerId,
            productId,
            liters: qty,
            vehicleId: vehicle?.id,
            driverId: driverId || undefined,
            plate: vehicle?.plate ?? plate.trim(),
            partyName,
            issuedOn: todayIso(),
            clientTotalCents: totalCents,
            lines: [{ description: product?.name ?? "Combustible", quantity: qty, totalCents }],
          };
          return void import("@/lib/offline/submit").then(async ({ reserveQueueKey }) => {
            const localId = `local-${reserveQueueKey("vale", payload)}`;
            const pending = {
              id: localId,
              customer_id: customerId,
              liters: String(qty),
              amount_cents: String(Math.round(qty * (product?.priceCents ?? 0))),
              status: "pendiente",
              product: product?.name ?? "",
              unit: product?.unit ?? "litro",
              plate: vehicle?.plate ?? (plate.trim() || null),
            };
            inflightLocals.current.add(localId);
            queryClient.setQueryData<FleetBoard>(["estacion-flota"], (current) => current ? { ...current, vouchers: reconcileFleetVouchers(current.vouchers, [pending, ...current.vouchers], new Set([localId, ...inflightLocals.current])) } : current);
            try {
              const result = await sendPlay("vale", "/api/estacion/flota/vale", payload);
              toast.success(result.queued ? "Vale guardado en este dispositivo" : "Vale cargado");
              resetValeForm();
              if (result.queued) return;
              const fresh = await apiGet<FleetBoard>("/api/estacion/flota", { fresh: true });
              const live = await liveLocalIds();
              live.delete(localId);
              const previous = queryClient.getQueryData<FleetBoard>(["estacion-flota"])?.vouchers ?? [];
              const keep = live;
              queryClient.setQueryData<FleetBoard>(["estacion-flota"], {
                ...fresh,
                vouchers: reconcileFleetVouchers(fresh.vouchers, previous, keep),
              });
            } catch (error) {
              queryClient.setQueryData<FleetBoard>(["estacion-flota"], (current) => current ? { ...current, vouchers: current.vouchers.filter((item) => item.id !== localId) } : current);
              toast.error(error instanceof Error ? error.message : "No se pudo cargar el vale");
            } finally {
              inflightLocals.current.delete(localId);
            }
          });
        }}>Cargar vale</Button> : null}
        {data.data?.canEdit ? <Button onClick={() => {
          if (!customerId) { setConfirmAll(true); return; }
          const open = (data.data?.vouchers ?? []).filter((voucher) => voucher.status === "abierto" && (!customerId || voucher.customer_id === customerId));
          const partyName = fleetCustomers.find((customer) => customer.id === customerId)?.name ?? "Clientes de flota";
          return void sendPlay("comprobante", "/api/estacion/flota/facturar", {
            customerId: customerId || undefined,
            from: "2026-01-01",
            to: "2026-12-31",
            partyName,
            issuedOn: todayIso(),
            clientTotalCents: open.reduce((sum, voucher) => sum + Number(voucher.amount_cents), 0),
            lines: open.map((voucher) => ({ description: voucher.product, quantity: Number(voucher.liters), totalCents: Number(voucher.amount_cents) })),
          }).then(async (result) => {
            const notice = !result.queued && result.data && typeof result.data === "object" && result.data && "notice" in result.data ? String((result.data as { notice?: string | null }).notice ?? "") : "";
            toast.success(result.queued ? "Comprobante provisorio. Se numera al volver la red." : (notice || (customerId ? "Cliente facturado" : "Facturamos a todos los clientes con vales")));
            if (!result.queued) {
              setCustomerId("");
              await queryClient.invalidateQueries({ queryKey: ["estacion-flota"] });
            }
          }).catch((error) => toast.error(error.message));
        }}>{customerId ? "Facturar cliente" : "Facturar a todos"}</Button> : null}
      </div>
    </div>
  );
}

function unionById<T extends { id: string }>(...groups: (readonly T[] | undefined)[]): T[] {
  const map = new Map<string, T>();
  for (const group of groups) {
    for (const item of group ?? []) map.set(item.id, item);
  }
  return [...map.values()];
}

function Reports() {
  const data = useQuery({ queryKey: ["estacion-informes"], queryFn: () => apiGet<{ rows: { product: string; nozzle: number; attendant: string; liters: string; amount: string }[] }>("/api/estacion/informes") });
  return (
    <table className="w-full text-sm">
      <thead><tr><th className="p-2 text-left">Producto</th><th className="p-2 text-left">Pico</th><th className="p-2 text-left">Playero</th><th className="p-2 text-left">Litros</th><th className="p-2 text-left">Importe</th></tr></thead>
      <tbody>
        {(data.data?.rows ?? []).map((row) => (
          <tr key={`${row.product}-${row.nozzle}-${row.attendant}`} className="border-t">
            <td className="p-2">{row.product}</td>
            <td className="p-2">{row.nozzle}</td>
            <td className="p-2">{row.attendant}</td>
            <td className="p-2">{formatQty(Number(row.liters))}</td>
            <td className="p-2">{formatMoney(Number(row.amount))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
