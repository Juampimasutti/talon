"use client";

import Link from "next/link";
import { useBrowserReady } from "@/components/use-browser-ready";
import { useState } from "react";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { readReceipt } from "@/lib/offline/submit";
import type { ProvisionalReceipt } from "@/lib/offline/engine";

export function ProvisorioScreen() {
  const ready = useBrowserReady();
  if (!ready) return <p className="p-6 text-sm text-stone-600">Abriendo el comprobante provisorio…</p>;
  return <ProvisorioDocument />;
}

function ProvisorioDocument() {
  const [receipt] = useState<ProvisionalReceipt | null>(readReceipt);
  if (!receipt) {
    return (
      <div className="mx-auto grid max-w-xl gap-3 p-6 text-stone-900">
        <p>No hay un comprobante provisorio en este dispositivo.</p>
        <Link className="text-sm underline" href="/estacion">Volver a la estación</Link>
      </div>
    );
  }

  return (
    <article className="mx-auto grid max-w-xl gap-4 bg-white p-6 text-stone-900">
      <p className="print:hidden">
        <Link className="text-sm underline" href="/estacion">Volver a la estación</Link>
      </p>
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-500">Sin validez fiscal</p>
        <h1 className="text-3xl">{receipt.printableTitle}</h1>
        <p className="text-sm">{receipt.localNumber} · {formatDate(receipt.issuedOn)}</p>
      </header>
      <p>{receipt.partyName}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Detalle</th>
            <th className="py-2">Cant.</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={`${line.description}-${line.quantity}`} className="border-b">
              <td className="py-2">{line.description}</td>
              <td className="py-2">{formatQty(line.quantity)}</td>
              <td className="py-2 text-right">{formatMoney(line.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex justify-between text-xl">
        <span>Total</span>
        <span>{formatMoney(receipt.totalCents)}</span>
      </p>
      <p className="text-sm text-stone-600">Provisorio. No tiene CAE ni número fiscal. Se numera cuando vuelve la conexión.</p>
      <button type="button" className="print:hidden h-9 rounded-lg border px-3 text-sm" onClick={() => window.print()}>Imprimir</button>
    </article>
  );
}
