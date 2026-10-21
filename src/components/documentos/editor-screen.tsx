"use client";

import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import {
  formatMoney,
  formatNumber,
  parseLocaleNumber,
  parseMoneyToCents,
  todayIso,
} from "@/lib/format";
import { documentLetter, type TaxCondition } from "@/lib/fiscal/letter";
import { creditExceeds, creditNoteGate } from "@/lib/stock-rules";
import { rateLabel, taxConditionLabel } from "@/lib/fiscal/labels";
import {
  calcDocument,
  previewKeepsVat,
  previewPriceMode,
  type TaxTreatment,
} from "@/lib/fiscal/totals";
import { useCatalog, useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PartyCreateDialog = dynamic(() =>
  import("@/components/directorio/party-create-dialog").then(
    (m) => m.PartyCreateDialog,
  ),
);

const META = {
  venta: {
    title: "Nueva venta",
    party: "Cliente",
    path: "/ventas",
    endpoint: "/api/clientes",
    module: "ventas",
  },
  compra: {
    title: "Nueva compra",
    party: "Proveedor",
    path: "/compras",
    endpoint: "/api/proveedores",
    module: "compras",
  },
  pedido: {
    title: "Nuevo pedido",
    party: "Cliente",
    path: "/pedidos",
    endpoint: "/api/clientes",
    module: "pedidos",
  },
  remito: {
    title: "Nuevo remito",
    party: "Cliente",
    path: "/remitos",
    endpoint: "/api/clientes",
    module: "remitos",
  },
} as const;

type PartyHit = {
  id: string;
  name: string;
  cuit: string | null;
  taxCondition: TaxCondition;
  priceListId?: string | null;
  iibbPerceptionBps?: number | null;
};
type ProductHit = {
  id: string;
  sku: string;
  name: string;
  ivaRateBps: number;
  taxTreatment: TaxTreatment;
  tracksStock: boolean;
  listPriceCents: number | null;
  costCents: number;
};
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
  const partyRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const issueLock = useRef(false);
  const sendIdentity = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const [duplicateDocumentId, setDuplicateDocumentId] = useState<string | null>(
    null,
  );
  const [partyError, setPartyError] = useState("");
  const [formError, setFormError] = useState("");
  const [creatingParty, setCreatingParty] = useState(false);
  const [activePartyIndex, setActivePartyIndex] = useState(-1);
  const [invalidField, setInvalidField] = useState("");
  const [moreOptions, setMoreOptions] = useState(false);
  const skuRef = useRef<HTMLInputElement>(null);
  const [partyQuery, setPartyQuery] = useState("");
  const debouncedParty = useDebounced(partyQuery);
  const [party, setParty] = useState<PartyHit | null>(null);
  const [typeId, setTypeId] = useState("");
  const [chosenPoint, setPoint] = useState<number | null>(null);
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [payment, setPayment] = useState<"contado" | "cuenta_corriente">(
    "cuenta_corriente",
  );
  const [chosenWarehouseId, setWarehouseId] = useState("");
  const [chosenListId, setListId] = useState("");
  const [perception, setPerception] = useState("");
  const [supplierPos, setSupplierPos] = useState("");
  const [supplierNumber, setSupplierNumber] = useState("");
  const [supplierCae, setSupplierCae] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [sourcePayment, setSourcePayment] = useState<
    "contado" | "cuenta_corriente" | null
  >(null);
  const [sourceCredit, setSourceCredit] = useState<{
    invoiceCents: number;
    creditedCents: number;
  } | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [otherTaxes, setOtherTaxes] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [sku, setSku] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const searchLock = useRef(false);
  const [pending, setPending] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);

  const types =
    catalog.data?.documentTypes.filter(
      (type) => type.kind === kind && type.code !== "REC",
    ) ?? [];
  const loadedOrigen = useRef("");
  const selectedType = types.find((type) => type.id === typeId) ?? types[0];

  useEffect(() => {
    if (kind !== "venta") return;
    const origen = new URLSearchParams(window.location.search).get("origen");
    if (!origen || !catalog.data || loadedOrigen.current === origen) return;
    loadedOrigen.current = origen;
    let cancelled = false;
    void apiGet<{
      id: string;
      kind: string;
      typeCode: string;
      paymentMethod: string;
      totalCents: number;
      derived?: { code: string; total_cents?: string }[];
      partyId: string | null;
      partyName: string;
      partyCuit: string | null;
      partyTaxCondition: TaxCondition;
      letter: string | null;
      pointOfSale: number;
      number: number;
      lines: {
        productId: string | null;
        sku: string | null;
        description: string;
        quantity: number;
        unitPriceCents: number;
        discountBps: number;
        ivaRateBps: number;
        taxTreatment: TaxTreatment;
      }[];
    }>(`/api/documentos/${origen}`)
      .then((doc) => {
        if (
          cancelled ||
          doc.kind !== "venta" ||
          doc.typeCode === "NCR" ||
          doc.typeCode === "REC" ||
          !doc.partyId
        )
          return;
        const inherited =
          doc.paymentMethod === "contado" ? "contado" : "cuenta_corriente";
        setSourcePayment(inherited);
        setPayment(inherited);
        const credited = (doc.derived ?? [])
          .filter((item) => item.code === "NCR" || item.code === "NCC")
          .reduce((sum, item) => sum + Number(item.total_cents ?? 0), 0);
        setSourceCredit({
          invoiceCents: Number(doc.totalCents),
          creditedCents: credited,
        });
        const note = catalog.data?.documentTypes.find(
          (type) => type.kind === "venta" && type.code === "NCR",
        );
        if (note) setTypeId(note.id);
        setParty({
          id: doc.partyId,
          name: doc.partyName,
          cuit: doc.partyCuit,
          taxCondition: doc.partyTaxCondition,
        });
        setSourceDocumentId(doc.id);
        setNotes(
          `Nota de crédito de ${doc.typeCode} ${formatNumber(doc.pointOfSale, doc.number)}`,
        );
        setLines(
          doc.lines.map((line) => ({
            key: crypto.randomUUID(),
            productId: line.productId,
            sku: line.sku ?? "",
            description: line.description,
            quantity: String(line.quantity).replace(".", ","),
            price: (line.unitPriceCents / 100).toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
            discount: String((line.discountBps ?? 0) / 100).replace(".", ","),
            ivaRateBps: line.ivaRateBps,
            taxTreatment: line.taxTreatment,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, catalog.data]);
  const listId =
    chosenListId ||
    catalog.data?.priceLists.find((item) => item.isDefault)?.id ||
    "";
  const warehouseId =
    chosenWarehouseId ||
    catalog.data?.warehouses.find((item) => item.isDefault)?.id ||
    "";

  const parties = useQuerySafe(
    me.data?.company.id,
    Boolean(debouncedParty.trim()) && !party,
    `${meta.endpoint}?active=1&q=${encodeURIComponent(debouncedParty)}&pageSize=8`,
  );

  const partyMatches =
    partyQuery.trim() === debouncedParty.trim()
      ? (parties.data?.items ?? [])
      : [];

  const letter = useMemo(() => {
    if (!me.data || !party) return null;
    const issuer = (
      kind === "compra" ? party.taxCondition : me.data.company.taxCondition
    ) as TaxCondition;
    const receiver = (
      kind === "compra" ? me.data.company.taxCondition : party.taxCondition
    ) as TaxCondition;
    return documentLetter(
      kind,
      Boolean(selectedType?.movesVat),
      issuer,
      receiver,
    );
  }, [selectedType, me.data, party, kind]);
  const movesVat = Boolean(selectedType?.movesVat);
  const priceMode = previewPriceMode(kind, movesVat, letter);
  const keepsVat = previewKeepsVat(kind, movesVat);

  const totals = useMemo(() => {
    return calcDocument({
      priceMode,
      otherTaxesCents: parseMoneyToCents(otherTaxes) ?? 0,
      perceptions: perception
        ? [
            {
              name: "Percepción IIBB",
              rateBps: Math.round((parseLocaleNumber(perception) ?? 0) * 100),
            },
          ]
        : [],
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

  async function emit(
    flags: {
      credit?: boolean;
      stock?: boolean;
      refund?: "contado" | "cuenta_corriente";
    } = {},
  ) {
    if (issueLock.current || creatingParty || catalog.isPending || !me.data)
      return;
    setFormError("");
    setDuplicateDocumentId(null);
    setInvalidField("");
    if (!types.length) {
      toast.error(
        "Esta empresa no tiene un comprobante de ese tipo. Crearlo en Comprobantes.",
      );
      return;
    }
    if (!selectedType) {
      setFormError("Seleccioná el tipo de comprobante");
      typeRef.current?.focus();
      return;
    }
    if (!party) {
      const message = `Seleccioná un ${meta.party.toLowerCase()} de la lista${partyQuery.trim() ? "; escribir el nombre no lo selecciona" : ""}`;
      setPartyError(message);
      toast.error(message);
      partyRef.current?.focus();
      return;
    }
    if (!issuedOn) {
      setFormError("Completá la fecha del comprobante");
      document.getElementById("document-date")?.focus();
      return;
    }
    if (lines.length === 0) {
      setFormError("Agregá al menos un artículo");
      skuRef.current?.focus();
      toast.error("Agregá al menos un artículo");
      return;
    }
    const invalid = (field: string, message: string) => {
      if (field === "document-taxes" || field === "document-perception") setMoreOptions(true);
      setInvalidField(field);
      setFormError(message);
      requestAnimationFrame(() => document.getElementById(field)?.focus());
    };
    for (const [index, line] of lines.entries()) {
      const quantity = parseLocaleNumber(line.quantity),
        price = parseMoneyToCents(line.price),
        discount = parseLocaleNumber(line.discount || "0");
      if (quantity == null || quantity <= 0 || quantity > 1_000_000) {
        invalid(
          `line-quantity-${index}`,
          `Revisá la cantidad de «${line.description}»: debe ser mayor que cero y como máximo 1.000.000.`,
        );
        return;
      }
      if (price == null || price < 0 || price > 1_000_000_000) {
        invalid(
          `line-price-${index}`,
          `Revisá el precio de «${line.description}».`,
        );
        return;
      }
      if (discount == null || discount < 0 || discount > 100) {
        invalid(
          `line-discount-${index}`,
          `El descuento de «${line.description}» debe estar entre 0 y 100%.`,
        );
        return;
      }
    }
    if (
      otherTaxes &&
      (parseMoneyToCents(otherTaxes) == null ||
        (parseMoneyToCents(otherTaxes) ?? 0) < 0)
    ) {
      invalid("document-taxes", "Revisá el importe de otros tributos.");
      return;
    }
    if (
      perception &&
      (parseLocaleNumber(perception) == null ||
        (parseLocaleNumber(perception) ?? 0) < 0 ||
        (parseLocaleNumber(perception) ?? 0) > 50)
    ) {
      invalid("document-perception", "La percepción debe estar entre 0 y 50%.");
      return;
    }
    if (kind === "compra")
      for (const [value, field, max] of [
        [supplierPos, "supplier-pos", 99999],
        [supplierNumber, "supplier-number", 99999999],
      ] as const) {
        if (
          value &&
          (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
        ) {
          invalid(
            field,
            field === "supplier-pos"
              ? "Revisá el punto de venta del proveedor (1 a 99999)."
              : "Revisá el número de factura del proveedor (1 a 99999999).",
          );
          return;
        }
      }
    if (navigator.onLine === false) {
      setFormError(
        "Sin conexión: este comprobante todavía no está guardado. Conservá esta pantalla y volvé a intentar al recuperar la conexión.",
      );
      return;
    }
    const exceeds = Boolean(
      sourceCredit &&
        selectedType.code === "NCR" &&
        creditExceeds(
          sourceCredit.invoiceCents,
          sourceCredit.creditedCents,
          totals.totalCents,
        ),
    );
    const gate =
      selectedType.code === "NCR"
        ? creditNoteGate(
            exceeds,
            sourcePayment === "contado",
            Boolean(flags.refund),
          )
        : "emitir";
    if (gate === "exceso") {
      setCredit(null);
      toast.error(
        "La nota de crédito supera lo que queda sin acreditar de esa factura",
      );
      return;
    }
    if (gate === "preguntar") {
      setRefundOpen(true);
      return;
    }
    const paymentMethod = flags.refund ?? payment;
    issueLock.current = true;
    setPending(true);
    try {
      const payload = {
        kind,
        documentTypeId: selectedType.id,
        pointOfSale: chosenPoint ?? me.data?.company.pointOfSale,
        partyId: party.id,
        issuedOn,
        paymentMethod,
        priceListId: listId || null,
        warehouseId: warehouseId || null,
        letter: kind === "compra" ? (letter ?? undefined) : undefined,
        notes,
        otherTaxesCents: parseMoneyToCents(otherTaxes) ?? 0,
        acknowledgeCredit: Boolean(flags.credit),
        allowNegativeStock: Boolean(flags.stock),
        perceptions: perception
          ? [
              {
                name: "Percepción IIBB",
                rateBps: Math.round((parseLocaleNumber(perception) ?? 0) * 100),
              },
            ]
          : undefined,
        supplierPos:
          kind === "compra" && supplierPos ? Number(supplierPos) : null,
        supplierNumber:
          kind === "compra" && supplierNumber ? Number(supplierNumber) : null,
        cae: kind === "compra" ? supplierCae.trim() : undefined,
        sourceDocumentId,
        lines: lines.map((line) => ({
          productId: line.productId,
          description: line.description,
          quantity: parseLocaleNumber(line.quantity) ?? 0,
          unitPriceCents: parseMoneyToCents(line.price) ?? 0,
          discountBps: Math.round(
            (parseLocaleNumber(line.discount) ?? 0) * 100,
          ),
        })),
      };
      const fingerprint = JSON.stringify(payload);
      if (sendIdentity.current?.fingerprint !== fingerprint)
        sendIdentity.current = { fingerprint, key: crypto.randomUUID() };
      const created = await apiSend<{ id: string; label: string }>(
        "/api/documentos",
        "POST",
        payload,
        { requestId: sendIdentity.current.key },
      );
      toast.dismiss();
      toast.success(`Listo: ${created.label}`);
      await queryClient.invalidateQueries({ queryKey: ["documentos"] });
      await queryClient.invalidateQueries({ queryKey: ["tablero"] });
      router.push(`${meta.path}/${created.id}`);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "No se recibió confirmación del servidor. Revisá la conexión y volvé a intentar sin cambiar los datos; este envío no se registrará dos veces.";
      if (
        error instanceof ApiError &&
        error.details &&
        typeof error.details === "object" &&
        "documentId" in error.details &&
        typeof error.details.documentId === "string"
      )
        setDuplicateDocumentId(error.details.documentId);
      const lower = message.toLowerCase();
      const exceedsRemainder = lower.includes("sin acreditar");
      const stock = lower.includes("stock");
      const creditLimit =
        !exceedsRemainder &&
        (lower.includes("crédito") || lower.includes("credito"));
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        !exceedsRemainder &&
        ((stock && !flags.stock) || (creditLimit && !flags.credit))
      ) {
        setCredit(message);
      } else {
        setCredit(null);
        setFormError(message);
        toast.error(message);
      }
    } finally {
      issueLock.current = false;
      setPending(false);
    }
  }

  saveRef.current = () => void emit();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"]')) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        !document.querySelector('[role="dialog"]')
      ) {
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
    if (!query || searchLock.current) return;
    searchLock.current = true;
    setSearchPending(true);
    try {
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
      if (!items.length)
        setFormError("No hay artículos con ese código o nombre.");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No se pudo buscar el artículo",
      );
    } finally {
      searchLock.current = false;
      setSearchPending(false);
    }
  }

  function chooseParty(item: PartyHit) {
    setParty(item);
    setPartyError("");
    setPartyQuery("");
    setActivePartyIndex(-1);
    if (item.priceListId) setListId(item.priceListId);
    setPerception(
      item.iibbPerceptionBps
        ? String(item.iibbPerceptionBps / 100).replace(".", ",")
        : "",
    );
  }

  function addProduct(product: ProductHit) {
    const cents =
      kind === "compra"
        ? product.costCents
        : (product.listPriceCents ?? product.costCents);
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        sku: product.sku,
        description: product.name,
        quantity: "1",
        price: (cents / 100).toLocaleString("es-AR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        discount: "0",
        ivaRateBps: product.ivaRateBps,
        taxTreatment: product.taxTreatment,
      },
    ]);
    setSku("");
    setHits([]);
    skuRef.current?.focus();
  }

  const priceHint =
    kind === "compra" || priceMode === "net"
      ? "Precio neto"
      : priceMode === "gross"
        ? "Precio final, IVA incluido"
        : "Sin IVA";
  const canEmit = me.data
    ? can(me.data.permissions, meta.module, "crear")
    : false;
  if (me.data && !canEmit) return null;

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-4xl tracking-tight">{meta.title}</h1>
        <p className="text-sm text-muted-foreground">
          F2 busca artículo · Enter en el código lo agrega · Ctrl+Enter emite
        </p>
        </div>
        <a href="#document-total" className="rounded border bg-card px-3 py-2 text-right text-sm focus-visible:outline-2 focus-visible:outline-primary"><span className="block text-muted-foreground">Revisar total · {lines.length} {lines.length === 1 ? "renglón" : "renglones"}</span><strong className="text-lg tabular-nums">{formatMoney(totals.totalCents)}</strong></a>
      </div>
      {creatingParty ? (
        <PartyCreateDialog
          kind={kind === "compra" ? "proveedores" : "clientes"}
          initialName={partyQuery}
          priceListId={listId}
          onClose={() => setCreatingParty(false)}
          onCreated={(item) => {
            chooseParty(item);
            setCreatingParty(false);
            toast.success(`${meta.party} creado y seleccionado`);
          }}
        />
      ) : null}
      {formError ? (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-card p-3 text-sm text-destructive"
        >
          {formError}
        </p>
      ) : null}
      {duplicateDocumentId ? (
        <a
          className="w-fit text-sm text-primary underline"
          href={`/compras/${duplicateDocumentId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver factura ya registrada
        </a>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm text-primary">
          Guardando comprobante…
        </p>
      ) : null}
      <div className="talon-document-fields grid grid-cols-2 gap-3 rounded-lg border bg-card p-3 sm:p-4 md:grid-cols-4">
        <label className="col-span-2 grid gap-1 text-sm">
          Comprobante
          <select
            ref={typeRef}
            className="h-9 rounded-lg border px-2"
            value={selectedType?.id ?? ""}
            onChange={(event) => setTypeId(event.target.value)}
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code} · {type.name}
              </option>
            ))}
          </select>
        </label>
        {(catalog.data?.pointsOfSale?.length ?? 0) > 1 ? (
          <label className="grid gap-1 text-sm">
            Punto de venta
            <select
              className="h-9 rounded-lg border px-2"
              value={chosenPoint ?? me.data?.company.pointOfSale}
              onChange={(event) => setPoint(Number(event.target.value))}
            >
              {catalog.data?.pointsOfSale?.map((point) => (
                <option key={point} value={point}>
                  {String(point).padStart(5, "0")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          Fecha
          <Input
            id="document-date"
            type="date"
            value={issuedOn}
            onChange={(event) => setIssuedOn(event.target.value)}
          />
        </label>
        <div className="grid gap-1 text-sm">
          Letra
          <p className="flex h-9 items-center text-2xl">{letter ?? "—"}</p>
        </div>
        <div className="relative col-span-2 grid gap-1 text-sm">
          <label htmlFor="document-party">{meta.party}</label>
          <Input
            id="document-party"
            ref={partyRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={!party && Boolean(partyMatches.length)}
            aria-controls="document-party-results"
            aria-activedescendant={
              activePartyIndex >= 0
                ? `document-party-option-${activePartyIndex}`
                : undefined
            }
            aria-invalid={Boolean(partyError)}
            aria-describedby="document-party-help"
            value={party ? party.name : partyQuery}
            placeholder={`Buscá y seleccioná un ${meta.party.toLowerCase()}`}
            onKeyDown={(event) => {
              const items = partyMatches;
              if (!party && ["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setActivePartyIndex((index) =>
                  items.length
                    ? (index +
                        (event.key === "ArrowDown" ? 1 : items.length - 1) +
                        items.length) %
                      items.length
                    : -1,
                );
              }
              if (
                !party &&
                event.key === "Enter" &&
                !event.ctrlKey &&
                !event.metaKey &&
                items.length
              ) {
                event.preventDefault();
                chooseParty(
                  items[activePartyIndex >= 0 ? activePartyIndex : 0],
                );
              }
              if (event.key === "Escape") {
                setActivePartyIndex(-1);
                setPartyQuery("");
              }
            }}
            onChange={(event) => {
              setParty(null);
              setPartyQuery(event.target.value);
              setPartyError("");
              setActivePartyIndex(-1);
            }}
          />
          <p
            id="document-party-help"
            className={`text-xs ${partyError ? "text-destructive" : party ? "text-emerald-700" : "text-muted-foreground"}`}
            role={partyError ? "alert" : "status"}
          >
            {partyError ||
              (party
                ? `${meta.party} seleccionado · ${party.cuit ?? "Sin documento"} · ${taxConditionLabel(party.taxCondition)}`
                : parties.isFetching
                  ? "Buscando…"
                  : partyQuery.trim()
                    ? partyMatches.length
                      ? "Elegí un resultado con clic o con flechas y Enter."
                      : "No hay coincidencias. Revisá el nombre o creá una ficha."
                    : "Escribí el nombre, CUIT o código y elegí un resultado.")}
          </p>
          {parties.error && !party ? (
            <p role="alert" className="text-xs text-destructive">
              No se pudo buscar. Revisá la conexión e intentá de nuevo.
            </p>
          ) : null}
          {!party && partyMatches.length ? (
            <ul
              id="document-party-results"
              role="listbox"
              aria-label={`Resultados de ${meta.party.toLowerCase()}`}
              className="max-h-44 overflow-auto rounded border bg-popover"
            >
              {partyMatches.map((item, index) => (
                <li
                  role="option"
                  aria-selected={activePartyIndex === index}
                  id={`document-party-option-${index}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className={`block w-full px-3 py-2 text-left hover:bg-accent ${activePartyIndex === index ? "bg-accent" : ""}`}
                    onClick={() => chooseParty(item)}
                  >
                    {item.name}
                    <span className="block text-xs text-muted-foreground">
                      {item.cuit ?? "Sin CUIT"} ·{" "}
                      {taxConditionLabel(item.taxCondition)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {me.data &&
          can(
            me.data.permissions,
            kind === "compra" ? "proveedores" : "clientes",
            "crear",
          ) ? (
            <button
              type="button"
              className="justify-self-start text-xs text-primary underline"
              onClick={() => setCreatingParty(true)}
            >
              Crear {meta.party.toLowerCase()} sin salir
            </button>
          ) : null}
        </div>
        {selectedType?.movesCash || selectedType?.movesAccount ? (
          <label className="grid gap-1 text-sm">
            Condición
            <select
              className="h-9 rounded-lg border px-2"
              value={payment}
              onChange={(event) =>
                setPayment(event.target.value as "contado" | "cuenta_corriente")
              }
            >
              <option value="cuenta_corriente">Cuenta corriente</option>
              <option value="contado">Contado</option>
            </select>
          </label>
        ) : null}
        {selectedType?.movesStock ? (
          <label className="grid gap-1 text-sm">
            Depósito
            <select
              className="h-9 rounded-lg border px-2"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
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
            <select
              className="h-9 rounded-lg border px-2"
              value={listId}
              onChange={(event) => setListId(event.target.value)}
              aria-label="Lista de precios"
            >
              {catalog.data?.priceLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Precios netos de{" "}
              {catalog.data?.priceLists.find((list) => list.id === listId)
                ?.name ?? "la lista"}
              . El total suma el IVA.
            </span>
          </label>
        ) : null}
      </div>

      <div className="min-w-0 rounded-lg border bg-card">
        <div className="grid gap-2 border-b p-3 md:grid-cols-[220px_1fr]">
          <div className="flex min-w-0 gap-2">
          <Input
            ref={skuRef}
            className="h-10 md:h-8"
            aria-label="Código de artículo"
            placeholder="Código o nombre y Enter"
            enterKeyHint="search"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchSku(sku);
              }
            }}
          />
          <Button type="button" className="h-10 shrink-0 md:hidden" disabled={searchPending || !sku.trim()} onClick={() => void searchSku(sku)}>{searchPending ? "Buscando…" : "Buscar"}</Button>
          </div>
          {hits.length > 1 ? (
            <ul className="max-h-40 overflow-auto rounded-lg border">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="block min-h-11 w-full px-3 py-2 text-left hover:bg-accent"
                    onClick={() => addProduct(hit)}
                  >
                    {hit.sku} · {hit.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="self-center text-sm text-muted-foreground">
              Si el código es exacto, entra solo.
            </p>
          )}
        </div>
        <div className="min-w-0 md:overflow-auto">
        <table className="block w-full text-sm md:table md:min-w-[720px]">
          <thead className="hidden bg-muted/70 text-left text-xs text-muted-foreground md:table-header-group">
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
          <tbody className="block md:table-row-group">
            {lines.map((line, index) => (
              <tr key={line.key} className="grid grid-cols-2 gap-x-3 gap-y-2 border-t p-3 first:border-t-0 md:table-row md:p-0 md:first:border-t">
                <td className="col-span-2 min-w-0 break-words text-xs text-muted-foreground md:px-3 md:py-2 md:text-sm">{line.sku}</td>
                <td className="col-span-2 min-w-0 break-words font-medium md:px-3 md:py-2 md:font-normal">{line.description}</td>
                <td className="min-w-0 md:px-3 md:py-2">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Cantidad</span>
                  <Input
                    inputMode="decimal"
                    id={`line-quantity-${index}`}
                    aria-label={`Cantidad de ${line.description}`}
                    aria-invalid={invalidField === `line-quantity-${index}`}
                    className="h-10 w-full md:h-8 md:w-20"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(index, { quantity: event.target.value })
                    }
                  />
                </td>
                <td className="min-w-0 md:px-3 md:py-2">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">{priceHint}</span>
                  <Input
                    inputMode="decimal"
                    id={`line-price-${index}`}
                    aria-label={`Precio de ${line.description}`}
                    aria-invalid={invalidField === `line-price-${index}`}
                    className="h-10 w-full md:h-8 md:w-28"
                    value={line.price}
                    onChange={(event) =>
                      updateLine(index, { price: event.target.value })
                    }
                  />
                </td>
                <td className="min-w-0 md:px-3 md:py-2">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Descuento %</span>
                  <Input
                    inputMode="decimal"
                    id={`line-discount-${index}`}
                    aria-label={`Descuento de ${line.description}`}
                    aria-invalid={invalidField === `line-discount-${index}`}
                    className="h-10 w-full md:h-8 md:w-16"
                    value={line.discount}
                    onChange={(event) =>
                      updateLine(index, { discount: event.target.value })
                    }
                  />
                </td>
                <td className="min-w-0 self-end text-right tabular-nums md:px-3 md:py-2">
                  <span className="mb-1 block text-xs text-muted-foreground md:hidden">Total del renglón</span>
                  {formatMoney(totals.lines[index]?.totalCents ?? 0)}
                </td>
                <td className="col-span-2 min-w-0 text-right md:px-3 md:py-2">
                  <button
                    type="button"
                    className="min-h-10 text-destructive md:min-h-0"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((item) => item.key !== line.key),
                      )
                    }
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!lines.length ? <p className="px-3 pb-3 text-sm text-muted-foreground">Buscá un artículo para agregar el primer renglón.</p> : null}
      </div>

      <div className="grid items-start gap-4 md:grid-cols-[1fr_280px]">
        <div className="grid content-start gap-3">
          <details open={moreOptions} onToggle={(event) => setMoreOptions(event.currentTarget.open)} className="rounded border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">Más opciones · impuestos y notas{perception || otherTaxes || notes ? " (con datos)" : ""}</summary>
            <div className="mt-3 grid gap-3">
              {selectedType?.movesVat || kind === "pedido" || kind === "remito" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Percepción IIBB %
                    <Input
                      id="document-perception"
                      aria-invalid={invalidField === "document-perception"}
                      value={perception}
                      onChange={(event) => setPerception(event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Otros tributos
                    <Input
                      id="document-taxes"
                      aria-invalid={invalidField === "document-taxes"}
                      value={otherTaxes}
                      onChange={(event) => setOtherTaxes(event.target.value)}
                      placeholder="0,00"
                    />
                  </label>
                </div>
              ) : null}
              <textarea
                className="min-h-20 rounded-lg border px-3 py-2 text-sm"
                aria-label="Notas internas"
                placeholder="Notas internas"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </details>
          {kind === "compra" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Punto de venta del proveedor
                <Input
                  id="supplier-pos"
                  aria-invalid={invalidField === "supplier-pos"}
                  value={supplierPos}
                  onChange={(event) => setSupplierPos(event.target.value)}
                  placeholder="Ej.: 1"
                />
              </label>
              <label className="grid gap-1 text-sm">
                Número de factura del proveedor
                <Input
                  id="supplier-number"
                  aria-invalid={invalidField === "supplier-number"}
                  value={supplierNumber}
                  onChange={(event) => setSupplierNumber(event.target.value)}
                  placeholder="Ej.: 1234"
                />
              </label>
              <label className="grid gap-1 text-sm">
                CAE del proveedor
                <Input
                  value={supplierCae}
                  onChange={(event) => setSupplierCae(event.target.value)}
                  placeholder="Si no tiene, dejalo vacío"
                />
              </label>
            </div>
          ) : null}
        </div>
        <aside id="document-total" className="scroll-mt-4 rounded border bg-card p-4">
          <Total label="Neto gravado" value={totals.netTaxedCents} />
          {totals.vatBreakdown.map((slice) => (
            <Total
              key={slice.rateBps}
              label={`IVA ${rateLabel(slice.rateBps)}`}
              value={slice.vatCents}
            />
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
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={() =>
                  void emit(
                    credit.toLowerCase().includes("stock")
                      ? { stock: true }
                      : { credit: true },
                  )
                }
              >
                Emitir igual
              </Button>
            </div>
          ) : null}
          <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>La factura se cobró de contado</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                ¿Devolvés el dinero en caja o el crédito queda a cuenta del
                cliente?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setRefundOpen(false);
                    setPayment("contado");
                    void emit({ refund: "contado" });
                  }}
                >
                  Devolver el dinero
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRefundOpen(false);
                    setPayment("cuenta_corriente");
                    void emit({ refund: "cuenta_corriente" });
                  }}
                >
                  Queda a cuenta
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            className="mt-4 h-10 w-full"
            disabled={pending || catalog.isPending || !me.data}
            onClick={() => void emit()}
          >
            {pending ? "Emitiendo…" : "Emitir"}
          </Button>
        </aside>
      </div>
    </div>
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setInvalidField("");
    setFormError("");
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
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

function useQuerySafe(
  companyId: string | undefined,
  enabled: boolean,
  path: string,
) {
  return useQuery({
    queryKey: ["buscar", companyId, path],
    enabled: enabled && Boolean(companyId),
    queryFn: () => apiGet<{ items: PartyHit[] }>(path),
  });
}
