"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can, type ModuleKey } from "@/lib/auth/permissions";
import { formatDate, formatMoney, formatNumber, formatQty } from "@/lib/format";
import { documentStatusLabel, invoiceBlocked } from "@/lib/stock-rules";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rateLabel, taxConditionLabel } from "@/lib/fiscal/labels";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScreenFallback } from "@/components/screen-fallback";

const META = {
  venta: { title: "Venta", path: "/ventas", module: "ventas" as ModuleKey },
  compra: { title: "Compra", path: "/compras", module: "compras" as ModuleKey },
  pedido: { title: "Pedido", path: "/pedidos", module: "pedidos" as ModuleKey },
  remito: { title: "Remito", path: "/remitos", module: "remitos" as ModuleKey },
};

type Detail = {
  id: string;
  letter: string | null;
  pointOfSale: number;
  number: number;
  issuedOn: string;
  partyName: string;
  partyCuit: string | null;
  partyTaxCondition: string | null;
  status: string;
  paymentMethod: string;
  priceMode: string;
  notes: string | null;
  netTaxedCents: number;
  vatCents: number;
  exemptCents: number;
  netUntaxedCents: number;
  perceptionsCents: number;
  derived?: { id: string; kind: string; number: number; letter: string | null; point_of_sale: number; code: string; total_cents?: string }[];
  sourceDoc?: { id: string; kind: string; number: number; letter: string | null; point_of_sale: number; code: string } | null;
  otherTaxesCents: number;
  totalCents: number;
  caeStatus: string;
  cae?: string | null;
  caeDue?: string | null;
  supplierPos?: number | null;
  supplierNumber?: number | null;
  typeCode: string;
  typeName: string;
  voidReason: string | null;
  lines: { id: string; sku: string | null; description: string; quantity: number; unitPriceCents: number; discountBps: number; ivaRateBps: number; netCents?: number; vatCents?: number; totalCents: number }[];
  taxes: { id: string; name: string; rateBps: number; amountCents: number }[];
};

export function DetalleScreen({ kind }: { kind: keyof typeof META }) {
  const meta = META[kind];
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const document = useQuery({
    queryKey: ["documento", params.id],
    queryFn: () => apiGet<Detail>(`/api/documentos/${params.id}`),
  });

  if (document.isLoading) return <ScreenFallback label="Abriendo el comprobante" />;
  if (document.isError || !document.data) return <p className="p-6">No pudimos abrir el comprobante.</p>;
  const data = document.data;
  const derived = data.derived ?? [];
  const hasRemito = derived.some((item) => item.kind === "remito");
  const hasFactura = derived.some((item) => item.kind === "venta");
  const childKinds = derived.map((item) => item.kind);
  const flow = hasFactura ? "facturado" : hasRemito ? "remitido" : "pendiente";
  const credited = derived.filter((item) => item.code === "NCR" || item.code === "NCC").reduce((sum, item) => sum + Number(item.total_cents ?? 0), 0);
  const fullyCredited = credited >= data.totalCents;
  const billBlocked = invoiceBlocked(kind, childKinds);
  const canVoid = me.data ? can(me.data.permissions, meta.module, "anular") && data.status !== "anulado" && flow === "pendiente" : false;

  async function derivar(target: "remito" | "venta" | "nota") {
    if (!data) return;
    setPending(true);
    try {
      const created = await apiSend<{ id: string; label: string }>(`/api/documentos/${data.id}/derivar`, "POST", { target });
      toast.success(created.label);
      router.push(target === "remito" ? `/remitos/${created.id}` : `/ventas/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo derivar");
    } finally {
      setPending(false);
    }
  }

  async function anular() {
    if (!voidReason.trim()) { toast.error("Escribí por qué lo anulás"); return; }
    setPending(true);
    try {
      await apiSend(`/api/documentos/${data.id}/anular`, "POST", { reason: voidReason.trim() });
      toast.success("Comprobante anulado");
      setVoidOpen(false);
      setVoidReason("");
      await queryClient.invalidateQueries({ queryKey: ["documento", data.id] });
      await queryClient.invalidateQueries({ queryKey: ["tablero"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo anular");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={meta.path} className="text-sm text-muted-foreground">
            ← {meta.title}s
          </Link>
          <h1 className="text-4xl tracking-tight">
            {data.typeCode} {data.letter ?? ""} {kind === "compra" && data.supplierNumber ? formatNumber(data.supplierPos ?? 0, data.supplierNumber) : formatNumber(data.pointOfSale, data.number)}
          </h1>
          {kind === "compra" && data.supplierNumber ? <p className="text-sm text-muted-foreground">Interno {formatNumber(data.pointOfSale, data.number)}</p> : null}
          <p className="text-muted-foreground">
            {data.partyName} · {data.partyCuit ?? "sin CUIT"} · {taxConditionLabel(data.partyTaxCondition)} · {formatDate(data.issuedOn)}
          </p>
        </div>
        <div className="flex gap-2">
          <span className={`rounded-full px-3 py-1 text-sm ${data.status === "anulado" ? "bg-destructive/10 text-destructive" : "bg-accent"}`}>{documentStatusLabel({ kind, status: data.status }, flow)}</span>
          <Button variant="outline" onClick={() => window.open(`${meta.path}/${data.id}/imprimir`, "_blank", "noopener")}>Imprimir / PDF</Button>
          {data.status === "confirmado" && kind === "pedido" && !hasRemito && !hasFactura && me.data && can(me.data.permissions, "remitos", "crear") ? (
            <Button variant="outline" disabled={pending} onClick={() => void derivar("remito")}>Remitir</Button>
          ) : null}
          {data.status === "confirmado" && (kind === "pedido" || kind === "remito") && !billBlocked && me.data && can(me.data.permissions, "ventas", "crear") ? (
            <Button disabled={pending} onClick={() => void derivar("venta")}>Facturar</Button>
          ) : null}
          {data.status === "confirmado" && kind === "venta" && data.typeCode !== "NCR" && data.typeCode !== "REC" && !fullyCredited && me.data && can(me.data.permissions, "ventas", "crear") ? (
            <Button variant="outline" disabled={pending} onClick={() => router.push(`/ventas/nueva?origen=${data.id}`)}>Emitir nota de crédito</Button>
          ) : null}
          {canVoid ? (
            <Button variant="destructive" disabled={pending} onClick={() => setVoidOpen(true)}>
              Anular
            </Button>
          ) : null}
        </div>
      </div>
      <Dialog open={voidOpen} onOpenChange={(open) => { if (!pending) setVoidOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Anular comprobante</DialogTitle></DialogHeader>
          <form noValidate className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void anular(); }}>
            <p className="text-sm">¿Por qué lo anulás?</p>
            <Input aria-label="Motivo" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={pending}>Anular</Button>
              <Button type="button" variant="outline" onClick={() => { setVoidOpen(false); setVoidReason(""); }}>Cancelar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {data.sourceDoc || derived.length ? (
        <p className="flex flex-wrap gap-3 text-sm">
          {data.sourceDoc ? <Link className="underline" href={docHref(data.sourceDoc)}>Comprobante de origen: {docLabel(data.sourceDoc)}</Link> : null}
          {derived.map((item) => <Link key={item.id} className="underline" href={docHref(item)}>{item.code === "NCR" || item.code === "NCC" ? "Nota de crédito: " : ""}{docLabel(item)}</Link>)}
        </p>
      ) : null}
      <div className="overflow-auto rounded-xl border bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-muted/70 text-left">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Cant.</th>
              <th className="px-3 py-2">{kind === "compra" ? "Precio neto" : "Precio"}</th>
              <th className="px-3 py-2">IVA</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="px-3 py-2">{line.sku || "—"}</td>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2">{formatQty(Number(line.quantity))}</td>
                <td className="px-3 py-2">{formatMoney(line.unitPriceCents)}</td>
                <td className="px-3 py-2">{rateLabel(Number(line.ivaRateBps))}{line.vatCents ? ` · ${formatMoney(line.vatCents)}` : ""}</td>
                <td className="px-3 py-2 text-right">{formatMoney(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="max-w-sm justify-self-end rounded-xl border bg-card p-4">
        <Row label="Neto gravado" value={data.netTaxedCents} />
        <Row label="IVA" value={data.vatCents} />
        <Row label="Exento" value={data.exemptCents} />
        <Row label="No gravado" value={data.netUntaxedCents} />
        <Row label="Percepciones" value={data.perceptionsCents} />
        <Row label="Otros tributos" value={data.otherTaxesCents} />
        {data.taxes.map((tax) => (
          <p key={tax.id} className="text-sm text-muted-foreground">
            {tax.name} {rateLabel(tax.rateBps)}
          </p>
        ))}
        <p className="mt-3 flex justify-between text-xl">
          <span>Total</span>
          <span>{formatMoney(data.totalCents)}</span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.paymentMethod === "contado" ? "Contado" : "Cuenta corriente"} · CAE: {data.caeStatus === "no_electronico" ? "no electrónico" : data.caeStatus}
        </p>
        {data.voidReason ? <p className="mt-2 text-sm">Motivo: {data.voidReason}</p> : null}
        {data.notes && !(data.sourceDoc && (data.notes.startsWith("Desde ") || data.notes.startsWith("Nota de crédito de "))) ? <p className="mt-2 text-sm">{data.notes}</p> : null}
      </aside>
    </div>
  );
}

function docHref(doc: { id: string; kind: string }) {
  const path = doc.kind === "venta" ? "/ventas" : doc.kind === "compra" ? "/compras" : doc.kind === "remito" ? "/remitos" : "/pedidos";
  return `${path}/${doc.id}`;
}

function docLabel(doc: { code: string; letter: string | null; point_of_sale: number; number: number }) {
  return `${doc.code} ${doc.letter ?? ""} ${formatNumber(doc.point_of_sale, doc.number)}`.replace(/\s+/g, " ");
}

function Row({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <p className="flex justify-between text-sm text-muted-foreground">
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </p>
  );
}
