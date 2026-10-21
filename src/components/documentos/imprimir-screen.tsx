"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api/client";
import { formatDate, formatMoney, formatNumber, formatQty } from "@/lib/format";
import { afipCodeFor, afipQrUrl } from "@/lib/fiscal/arca";
import { rateLabel, taxConditionLabel } from "@/lib/fiscal/labels";
import { useMe } from "@/components/use-me";
import { ScreenFallback } from "@/components/screen-fallback";

type PrintDoc = {
  id: string;
  kind: string;
  letter: string | null;
  pointOfSale: number;
  number: number;
  issuedOn: string;
  partyName: string;
  partyCuit: string | null;
  partyTaxCondition: string | null;
  paymentMethod: string;
  notes: string | null;
  netTaxedCents: number;
  vatCents: number;
  exemptCents: number;
  netUntaxedCents: number;
  perceptionsCents: number;
  otherTaxesCents: number;
  totalCents: number;
  cae: string | null;
  caeDue: string | null;
  caeStatus: string;
  supplierPos?: number | null;
  supplierNumber?: number | null;
  typeCode: string;
  afipCodes?: Record<string, number>;
  lines: { id: string; sku: string | null; description: string; quantity: number; unitPriceCents: number; ivaRateBps: number; vatCents?: number; totalCents: number }[];
};

const PATH = { venta: "/ventas", compra: "/compras", pedido: "/pedidos", remito: "/remitos" } as const;

export function ImprimirScreen({ kind }: { kind: keyof typeof PATH }) {
  const params = useParams<{ id: string }>();
  const me = useMe();
  const document = useQuery({
    queryKey: ["documento", params.id],
    queryFn: () => apiGet<PrintDoc>(`/api/documentos/${params.id}`),
  });
  const [qrReadyFor, setQrReadyFor] = useState<string | null>(null);
  const onQrReady = useCallback((url: string) => setQrReadyFor(url), []);
  const data = document.data;
  const company = me.data?.company;
  const fiscalNumber = data && kind === "compra" && data.supplierNumber ? formatNumber(data.supplierPos ?? 0, data.supplierNumber) : data ? formatNumber(data.pointOfSale, data.number) : "";
  const qrUrl = data && company ? afipQrUrl({
    cuit: company.cuit,
    pointOfSale: data.pointOfSale,
    afipCode: afipCodeFor(data.afipCodes, data.letter),
    number: data.number,
    issuedOn: data.issuedOn,
    totalCents: data.totalCents,
    receiverCuit: data.partyCuit,
    cae: data.cae,
  }) : null;

  useEffect(() => {
    if (!data || !company || (qrUrl && qrReadyFor !== qrUrl)) return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [data, company, qrUrl, qrReadyFor]);

  if (document.isLoading || me.isLoading) return <ScreenFallback label="Armando la impresión" />;
  if (!data || !company) return <p className="p-6">No pudimos abrir el comprobante.</p>;

  return (
    <article className="mx-auto grid max-w-3xl gap-4 bg-white p-6 text-stone-900">
      <p className="print:hidden">
        <Link className="text-sm underline" href={`${PATH[kind]}/${data.id}`}>Volver al detalle</Link>
      </p>
      <header>
        <p className="text-lg font-semibold">{company.legalName}</p>
        <p className="text-sm">CUIT {company.cuit}{company.city ? ` · ${company.city}` : ""}{company.province ? `, ${company.province}` : ""} · PV {String(company.pointOfSale).padStart(4, "0")}</p>
        <h1 className="mt-3 text-3xl">{data.typeCode} {data.letter ?? ""} {fiscalNumber}</h1>
        {kind === "compra" && data.supplierNumber ? <p className="text-sm">Número interno {formatNumber(data.pointOfSale, data.number)}</p> : null}
      </header>
      <p>
        {data.partyName}<br />
        {data.partyCuit ?? "sin CUIT"} · {taxConditionLabel(data.partyTaxCondition)} · {formatDate(data.issuedOn)}
      </p>
      <table className="w-full text-sm">
        <thead className="border-b text-left">
          <tr>
            <th className="py-2">Código</th>
            <th>Descripción</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>IVA</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2">{line.sku || "—"}</td>
              <td>{line.description}</td>
              <td>{formatQty(Number(line.quantity))}</td>
              <td>{formatMoney(line.unitPriceCents)}</td>
              <td>{rateLabel(Number(line.ivaRateBps))}{line.vatCents ? ` · ${formatMoney(line.vatCents)}` : ""}</td>
              <td className="text-right">{formatMoney(line.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="grid justify-end gap-1 text-sm">
        <Row label="Neto gravado" value={data.netTaxedCents} />
        <Row label="IVA" value={data.vatCents} />
        <Row label="Exento" value={data.exemptCents} />
        <Row label="No gravado" value={data.netUntaxedCents} />
        <Row label="Percepciones" value={data.perceptionsCents} />
        <Row label="Otros tributos" value={data.otherTaxesCents} />
        <div className="mt-2 flex justify-between gap-8 text-xl">
          <dt>Total</dt>
          <dd>{formatMoney(data.totalCents)}</dd>
        </div>
      </dl>
      <footer className="flex items-end justify-between gap-4 text-sm">
        <div>
          <p>{data.paymentMethod === "contado" ? "Contado" : "Cuenta corriente"}</p>
          {data.cae ? <p>CAE {data.cae}{data.caeDue ? ` · vence ${formatDate(data.caeDue)}` : ""}</p> : kind === "compra" ? null : <p>CAE: {data.caeStatus === "no_electronico" ? "no electrónico" : data.caeStatus}</p>}
        </div>
        {qrUrl ? <Qr url={qrUrl} onReady={onQrReady} /> : null}
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-8">
      <dt>{label}</dt>
      <dd>{formatMoney(value)}</dd>
    </div>
  );
}

function Qr({ url, onReady }: { url: string; onReady: (url: string) => void }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((mod) => mod.default.toString(url, { type: "svg", margin: 1, width: 140 })).then((value) => { if (!cancelled) { setSvg(value); setFailed(false); onReady(url); } }).catch(() => { if (!cancelled) { setSvg(""); setFailed(true); } });
    return () => { cancelled = true; };
  }, [url, onReady]);
  if (failed) return <p role="alert" className="print:hidden">No se pudo generar el QR. Recargá el comprobante para reintentar.</p>;
  if (!svg) return null;
  return <div className="size-36" aria-label="QR del comprobante" dangerouslySetInnerHTML={{ __html: svg }} />;
}
