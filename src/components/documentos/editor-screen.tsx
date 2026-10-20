"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { formatMoney, formatNumber, parseLocaleNumber, parseMoneyToCents, todayIso } from "@/lib/format";
import { documentLetter, type TaxCondition } from "@/lib/fiscal/letter";
import { creditExceeds, creditNoteGate } from "@/lib/stock-rules";
import { rateLabel, taxConditionLabel } from "@/lib/fiscal/labels";
import { calcDocument, previewKeepsVat, previewPriceMode, type TaxTreatment } from "@/lib/fiscal/totals";
import { useCatalog, useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const META = {
  venta: { title: "Nueva venta", party: "Cliente", path: "/ventas", endpoint: "/api/clientes", module: "ventas" },
  compra: { title: "Nueva compra", party: "Proveedor", path: "/compras", endpoint: "/api/proveedores", module: "compras" },
  pedido: { title: "Nuevo pedido", party: "Cliente", path: "/pedidos", endpoint: "/api/clientes", module: "pedidos" },
  remito: { title: "Nuevo remito", party: "Cliente", path: "/remitos", endpoint: "/api/clientes", module: "remitos" },
} as const;

type PartyHit = { id: string; name: string; cuit: string | null; taxCondition: TaxCondition; priceListId?: string | null; iibbPerceptionBps?: number | null };
type ProductHit = { id: string; sku: string; name: string; ivaRateBps: number; taxTreatment: TaxTreatment; tracksStock: boolean; listPriceCents: number | null; costCents: number };
type DraftLine = {
  key: string;
  productId: string | null;
  sku: string;
  description: string;
  quantity: string;
  price: string;
  discount: string;
  ivaRateBps: number;
  taxTreatment: TaxTreatment;
};

export function EditorScreen({ kind }: { kind: keyof typeof META }) {
  const meta = META[kind];
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const skuRef = useRef<HTMLInputElement>(null);
  const [partyQuery, setPartyQuery] = useState("");
  const debouncedParty = useDebounced(partyQuery);
  const [party, setParty] = useState<PartyHit | null>(null);
  const [typeId, setTypeId] = useState("");
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [payment, setPayment] = useState<"contado" | "cuenta_corriente">("cuenta_corriente");
  const [chosenWarehouseId, setWarehouseId] = useState("");
  const [chosenListId, setListId] = useState("");
  const [perception, setPerception] = useState("");
  const [supplierPos, setSupplierPos] = useState("");
  const [supplierNumber, setSupplierNumber] = useState("");
  const [supplierCae, setSupplierCae] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [sourcePayment, setSourcePayment] = useState<"contado" | "cuenta_corriente" | null>(null);
  const [sourceCredit, setSourceCredit] = useState<{ invoiceCents: number; creditedCents: number } | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [otherTaxes, setOtherTaxes] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [sku, setSku] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [pending, setPending] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);

  const types = catalog.data?.documentTypes.filter((type) => type.kind === kind && type.code !== "REC") ?? [];
  const loadedOrigen = useRef("");
  const selectedType = types.find((type) => type.id === typeId) ?? types[0];

  useEffect(() => {
    if (kind !== "venta") return;
    const origen = new URLSearchParams(window.location.search).get("origen");
    if (!origen || !catalog.data || loadedOrigen.current === origen) return;
    loadedOrigen.current = origen;
    let cancelled = false;
    void apiGet<{ id: string; kind: string; typeCode: string; paymentMethod: string; totalCents: number; derived?: { code: string; total_cents?: string }[]; partyId: string | null; partyName: string; partyCuit: string | null; partyTaxCondition: TaxCondition; letter: string | null; pointOfSale: number; number: number; lines: { productId: string | null; sku: string | null; description: string; quantity: number; unitPriceCents: number; discountBps: number; ivaRateBps: number; taxTreatment: TaxTreatment }[] }>(`/api/documentos/${origen}`).then((doc) => {
      if (cancelled || doc.kind !== "venta" || doc.typeCode === "NCR" || doc.typeCode === "REC" || !doc.partyId) return;
      const inherited = doc.paymentMethod === "contado" ? "contado" : "cuenta_corriente";
      setSourcePayment(inherited);
      setPayment(inherited);
      const credited = (doc.derived ?? []).filter((item) => item.code === "NCR" || item.code === "NCC").reduce((sum, item) => sum + Number(item.total_cents ?? 0), 0);
      setSourceCredit({ invoiceCents: Number(doc.totalCents), creditedCents: credited });
      const note = catalog.data?.documentTypes.find((type) => type.kind === "venta" && type.code === "NCR");
      if (note) setTypeId(note.id);
      setParty({ id: doc.partyId, name: doc.partyName, cuit: doc.partyCuit, taxCondition: doc.partyTaxCondition });
      setSourceDocumentId(doc.id);
      setNotes(`Nota de crédito de ${doc.typeCode} ${formatNumber(doc.pointOfSale, doc.number)}`);
      setLines(doc.lines.map((line) => ({
        key: crypto.randomUUID(),
        productId: line.productId,
        sku: line.sku ?? "",
        description: line.description,
        quantity: String(line.quantity).replace(".", ","),
        price: (line.unitPriceCents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        discount: String((line.discountBps ?? 0) / 100).replace(".", ","),
        ivaRateBps: line.ivaRateBps,
        taxTreatment: line.taxTreatment,
      })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [kind, catalog.data]);
  const listId = chosenListId || catalog.data?.priceLists.find((item) => item.isDefault)?.id || "";
  const warehouseId = chosenWarehouseId || catalog.data?.warehouses.find((item) => item.isDefault)?.id || "";

  const parties = useQuerySafe(Boolean(debouncedParty) && !party, `${meta.endpoint}?q=${encodeURIComponent(debouncedParty)}&pageSize=8`);

  const letter = useMemo(() => {
    if (!me.data || !party) return null;
    const issuer = (kind === "compra" ? party.taxCondition : me.data.company.taxCondition) as TaxCondition;
    const receiver = (kind === "compra" ? me.data.company.taxCondition : party.taxCondition) as TaxCondition;
    return documentLetter(kind, Boolean(selectedType?.movesVat), issuer, receiver);
  }, [selectedType, me.data, party, kind]);
  const movesVat = Boolean(selectedType?.movesVat);
  const priceMode = previewPriceMode(kind, movesVat, letter);
  const keepsVat = previewKeepsVat(kind, movesVat);

  const totals = useMemo(() => {
    return calcDocument({
      priceMode,
      otherTaxesCents: parseMoneyToCents(otherTaxes) ?? 0,
      perceptions: perception ? [{ name: "Percepción IIBB", rateBps: Math.round((parseLocaleNumber(perception) ?? 0) * 100) }] : [],
      lines: lines.map((line) => ({
        quantity: parseLocaleNumber(line.quantity) ?? 0,
        unitPriceCents: parseMoneyToCents(line.price) ?? 0,
        discountBps: Math.round((parseLocaleNumber(line.discount) ?? 0) * 100),
        ivaRateBps: keepsVat ? line.ivaRateBps : 0,
        taxTreatment: keepsVat ? line.taxTreatment : "no_gravado",
      })),
    });
  }, [lines, priceMode, keepsVat, otherTaxes, perception]);

  const saveRef = useRef<() => void>(() => {});

  async function emit(flags: { credit?: boolean; stock?: boolean; refund?: "contado" | "cuenta_corriente" } = {}) {
    if (!types.length) {
      toast.error("Esta empresa no tiene un comprobante de ese tipo. Crearlo en Comprobantes.");
      return;
    }
    if (!party || !selectedType) {
      toast.error("Elegí el comprobante y la cuenta");
      return;
    }
    if (lines.length === 0) {
      toast.error("Agregá al menos un renglón");
      return;
    }
    const exceeds = Boolean(sourceCredit && selectedType.code === "NCR" && creditExceeds(sourceCredit.invoiceCents, sourceCredit.creditedCents, totals.totalCents));
    const gate = selectedType.code === "NCR" ? creditNoteGate(exceeds, sourcePayment === "contado", Boolean(flags.refund)) : "emitir";
    if (gate === "exceso") {
      setCredit(null);
      toast.error("La nota de crédito supera lo que queda sin acreditar de esa factura");
      return;
    }
    if (gate === "preguntar") {
      setRefundOpen(true);
      return;
    }
    const paymentMethod = flags.refund ?? payment;
    setPending(true);
    try {
      const created = await apiSend<{ id: string; label: string }>("/api/documentos", "POST", {
        kind,
        documentTypeId: selectedType.id,
        partyId: party.id,
        issuedOn,
        paymentMethod,
        priceListId: listId || null,
        warehouseId: warehouseId || null,
        letter: kind === "compra" ? letter ?? undefined : undefined,
        notes,
        otherTaxesCents: parseMoneyToCents(otherTaxes) ?? 0,
        acknowledgeCredit: Boolean(flags.credit),
        allowNegativeStock: Boolean(flags.stock),
        perceptions: perception ? [{ name: "Percepción IIBB", rateBps: Math.round((parseLocaleNumber(perception) ?? 0) * 100) }] : undefined,
        supplierPos: kind === "compra" && supplierPos ? Number(supplierPos) : null,
        supplierNumber: kind === "compra" && supplierNumber ? Number(supplierNumber) : null,
        cae: kind === "compra" ? supplierCae.trim() : undefined,
        sourceDocumentId,
        lines: lines.map((line) => ({
          productId: line.productId,
          description: line.description,
          quantity: parseLocaleNumber(line.quantity) ?? 0,
          unitPriceCents: parseMoneyToCents(line.price) ?? 0,
          discountBps: Math.round((parseLocaleNumber(line.discount) ?? 0) * 100),
        })),
      });
      toast.dismiss();
      toast.success(`Listo: ${created.label}`);
      await queryClient.invalidateQueries({ queryKey: ["documentos"] });
      await queryClient.invalidateQueries({ queryKey: ["tablero"] });
      router.push(`${meta.path}/${created.id}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "No se pudo emitir";
      const lower = message.toLowerCase();
      const exceedsRemainder = lower.includes("sin acreditar");
      const stock = lower.includes("stock");
      const creditLimit = !exceedsRemainder && (lower.includes("crédito") || lower.includes("credito"));
      if (error instanceof ApiError && error.status === 409 && !exceedsRemainder && ((stock && !flags.stock) || (creditLimit && !flags.credit))) {
        setCredit(message);
      } else {
        setCredit(null);
        toast.error(message);
      }
    } finally {
      setPending(false);
    }
  }

  saveRef.current = () => void emit();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        saveRef.current();
      }
      if (event.key === "F2") {
        event.preventDefault();
        skuRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function searchSku(value: string) {
    const query = value.trim();
    if (!query) return;
    const exact = await apiGet<{ items: ProductHit[] }>(
      `/api/articulos?q=${encodeURIComponent(query)}&exact=1&pageSize=5${listId ? `&priceListId=${listId}` : ""}`,
    );
    const items = exact.items.length
      ? exact.items
      : (
          await apiGet<{ items: ProductHit[] }>(
            `/api/articulos?q=${encodeURIComponent(query)}&pageSize=8${listId ? `&priceListId=${listId}` : ""}`,
          )
        ).items;
    if (items.length === 1) addProduct(items[0]);
    else setHits(items);
  }

  function addProduct(product: ProductHit) {
    const cents = kind === "compra" ? product.costCents : (product.listPriceCents ?? product.costCents);
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        sku: product.sku,
        description: product.name,
        quantity: "1",
        price: (cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        discount: "0",
        ivaRateBps: product.ivaRateBps,
        taxTreatment: product.taxTreatment,
      },
    ]);
    setSku("");
    setHits([]);
    skuRef.current?.focus();
  }

  const priceHint = kind === "compra" || priceMode === "net" ? "Precio neto" : priceMode === "gross" ? "Precio final, IVA incluido" : "Sin IVA";
  const canEmit = me.data ? can(me.data.permissions, meta.module, "crear") : false;
  if (me.data && !canEmit) return null;

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">{meta.title}</h1>
        <p className="text-sm text-muted-foreground">F2 busca artículo · Enter en el código lo agrega · Ctrl+Enter emite</p>
      </div>
      <div className="talon-document-fields grid grid-cols-2 gap-3 rounded-lg border bg-card p-3 sm:p-4 md:grid-cols-4">
        <label className="col-span-2 grid gap-1 text-sm">
          Comprobante
          <select className="h-9 rounded-lg border px-2" value={selectedType?.id ?? ""} onChange={(event) => setTypeId(event.target.value)}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code} · {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Fecha
          <Input type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
        </label>
        <div className="grid gap-1 text-sm">
          Letra
          <p className="flex h-9 items-center text-2xl">{letter ?? "—"}</p>
        </div>
        <label className="relative col-span-2 grid gap-1 text-sm">
          {meta.party}
          <Input
            value={party ? party.name : partyQuery}
            placeholder={`Buscá un ${meta.party.toLowerCase()}`}
            onChange={(event) => {
              setParty(null);
              setPartyQuery(event.target.value);
            }}
          />
          {!party && parties.data?.items?.length ? (
            <ul className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover shadow-md">
              {parties.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      setParty(item);
                      if (item.priceListId) setListId(item.priceListId);
                      if (item.iibbPerceptionBps) setPerception(String(item.iibbPerceptionBps / 100).replace(".", ","));
                    }}
                  >
                    {item.name}
                    <span className="block text-xs text-muted-foreground">
                      {item.cuit ?? "Sin CUIT"} · {taxConditionLabel(item.taxCondition)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
        {selectedType?.movesCash || selectedType?.movesAccount ? (
          <label className="grid gap-1 text-sm">
            Condición
            <select className="h-9 rounded-lg border px-2" value={payment} onChange={(event) => setPayment(event.target.value as "contado" | "cuenta_corriente")}>
              <option value="cuenta_corriente">Cuenta corriente</option>
              <option value="contado">Contado</option>
            </select>
          </label>
        ) : null}
        {selectedType?.movesStock ? (
          <label className="grid gap-1 text-sm">
            Depósito
            <select className="h-9 rounded-lg border px-2" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              {catalog.data?.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === "venta" ? (
          <label className="grid gap-1 text-sm">
            Lista
            <select className="h-9 rounded-lg border px-2" value={listId} onChange={(event) => setListId(event.target.value)} aria-label="Lista de precios">
              {catalog.data?.priceLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">Precios netos de {catalog.data?.priceLists.find((list) => list.id === listId)?.name ?? "la lista"}. El total suma el IVA.</span>
          </label>
        ) : null}
      </div>

      <div className="overflow-auto rounded-lg border bg-card">
        <p className="sticky left-0 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground md:hidden">Deslizá la tabla para ver cantidades, precios y totales →</p>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/70 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Cant.</th>
              <th className="px-3 py-2">{priceHint}</th>
              <th className="px-3 py-2">Dto %</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.key} className="border-t">
                <td className="px-3 py-2">{line.sku}</td>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2">
                  <Input className="w-20" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Input className="w-28" value={line.price} onChange={(event) => updateLine(index, { price: event.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <Input className="w-16" value={line.discount} onChange={(event) => updateLine(index, { discount: event.target.value })} />
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(totals.lines[index]?.totalCents ?? 0)}</td>
                <td className="px-3 py-2">
                  <button type="button" className="text-destructive" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-2 border-t p-3 md:grid-cols-[220px_1fr]">
          <Input
            ref={skuRef}
            aria-label="Código de artículo"
            placeholder="Código o nombre y Enter"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchSku(sku);
              }
            }}
          />
          {hits.length > 1 ? (
            <ul className="max-h-40 overflow-auto rounded-lg border">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button type="button" className="block w-full px-3 py-2 text-left hover:bg-accent" onClick={() => addProduct(hit)}>
                    {hit.sku} · {hit.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="self-center text-sm text-muted-foreground">Si el código es exacto, entra solo.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="grid gap-3">
          {selectedType?.movesVat || kind === "pedido" || kind === "remito" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Percepción IIBB %
                <Input value={perception} onChange={(event) => setPerception(event.target.value)} placeholder="3" />
              </label>
              <label className="grid gap-1 text-sm">
                Otros tributos
                <Input value={otherTaxes} onChange={(event) => setOtherTaxes(event.target.value)} placeholder="0,00" />
              </label>
            </div>
          ) : null}
          {kind === "compra" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Punto de venta del proveedor
                <Input value={supplierPos} onChange={(event) => setSupplierPos(event.target.value)} placeholder="1" />
              </label>
              <label className="grid gap-1 text-sm">Número de factura del proveedor
                <Input value={supplierNumber} onChange={(event) => setSupplierNumber(event.target.value)} placeholder="1234" />
              </label>
              <label className="grid gap-1 text-sm">CAE del proveedor
                <Input value={supplierCae} onChange={(event) => setSupplierCae(event.target.value)} placeholder="Si no tiene, dejalo vacío" />
              </label>
            </div>
          ) : null}
          <textarea className="min-h-20 rounded-lg border px-3 py-2 text-sm" placeholder="Notas internas" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <aside className="rounded-xl border bg-card p-4">
          <Total label="Neto gravado" value={totals.netTaxedCents} />
          {totals.vatBreakdown.map((slice) => (
            <Total key={slice.rateBps} label={`IVA ${rateLabel(slice.rateBps)}`} value={slice.vatCents} />
          ))}
          <Total label="Exento" value={totals.exemptCents} />
          <Total label="No gravado" value={totals.netUntaxedCents} />
          <Total label="Percepciones" value={totals.perceptionsCents} />
          <p className="mt-3 flex items-center justify-between text-xl">
            <span>Total</span>
            <span>{formatMoney(totals.totalCents)}</span>
          </p>
          {credit ? (
            <div className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
              {credit}
              <Button className="mt-2 w-full" variant="outline" onClick={() => void emit(credit.toLowerCase().includes("stock") ? { stock: true } : { credit: true })}>
                Emitir igual
              </Button>
            </div>
          ) : null}
          <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>La factura se cobró de contado</DialogTitle></DialogHeader>
              <p className="text-sm">¿Devolvés el dinero en caja o el crédito queda a cuenta del cliente?</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setRefundOpen(false); setPayment("contado"); void emit({ refund: "contado" }); }}>Devolver el dinero</Button>
                <Button variant="outline" onClick={() => { setRefundOpen(false); setPayment("cuenta_corriente"); void emit({ refund: "cuenta_corriente" }); }}>Queda a cuenta</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button className="mt-4 h-10 w-full" disabled={pending} onClick={() => void emit()}>
            {pending ? "Emitiendo…" : "Emitir"}
          </Button>
        </aside>
      </div>
    </div>
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }
}

function Total({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <p className="flex justify-between text-sm text-muted-foreground">
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </p>
  );
}

function useQuerySafe(enabled: boolean, path: string) {
  return useQuery({
    queryKey: ["buscar", path],
    enabled,
    queryFn: () => apiGet<{ items: PartyHit[] }>(path),
  });
}
