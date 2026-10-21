"use client";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
type Row = Record<string, string | number | boolean | null>;
export function CertificatePrint({ id }: { id: string }) {
  const result = useQuery({
    queryKey: ["certificate-print", id],
    queryFn: () =>
      apiGet<{ certificate: Row; lines: Row[] }>(
        `/api/constructora/certificados/${id}`,
      ),
  });
  if (result.error) return <p role="alert">{result.error.message}</p>;
  if (!result.data) return <p>Cargando certificado…</p>;
  const { certificate: c, lines } = result.data;
  return (
    <main className="mx-auto grid max-w-4xl gap-4 bg-white p-5 text-slate-950">
      <div className="print:hidden">
        <Button onClick={() => window.print()}>Imprimir certificado</Button>
      </div>
      <h1 className="text-2xl font-semibold">
        Certificado de obra · {c.period}
      </h1>
      <p>
        {c.work_name} · {c.location}
        <br />
        Cliente: {c.customer_name}
        <br />
        Emisión: {formatDate(String(c.issued_on))}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th>Rubro / ítem</th>
            <th>Acumulado</th>
            <th>Importe del período</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr className="border-b" key={String(line.id)}>
              <td className="py-2">
                {line.rubro} · {line.description}
              </td>
              <td>
                {line.global_item
                  ? `${Number(line.cumulative_bps) / 100}%`
                  : Number(line.cumulative_quantity_milli) / 1000}
              </td>
              <td className="text-right">
                {formatMoney(Number(line.period_cents))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto grid w-full max-w-lg gap-2 text-sm">
        {[
          ["Certificado básico", Number(c.base_cents)],
          ["Ajuste CAC", Number(c.adjustment_cents)],
          [
            "Devolución proporcional de anticipo",
            -Number(c.advance_returned_cents),
          ],

          ["Neto facturado", Number(c.tax_base_cents)],
          ["IVA", Number(c.vat_cents)],
          [
            "Otros impuestos según factura",
            Number(c.total_cents) -
              Number(c.tax_base_cents) -
              Number(c.vat_cents),
          ],
          ["Total factura", Number(c.total_cents)],
          [
            "Fondo de reparo retenido (sin reducir IVA)",
            Number(c.repair_cents),
          ],
          [
            "A cobrar antes de liberar reparo",
            Number(c.total_cents) - Number(c.repair_cents),
          ],
        ].map(([label, value]) => (
          <p className="flex justify-between gap-4" key={String(label)}>
            <span>{label}</span>
            <strong>{formatMoney(Number(value))}</strong>
          </p>
        ))}
      </div>
      <p className="text-sm">
        Avance informativo: {Number(c.progress_bps) / 100}%.{" "}
        {c.cac_month
          ? `CAC ${c.cac_month}: ${c.cac_index}. Fuente: ${c.cac_source}`
          : "Sin ajuste CAC pactado."}
      </p>
      <p className="text-sm">{c.notes}</p>
      <p className="text-xs">
        Certificado de medición. El comprobante fiscal asociado se consulta en
        Ventas.
      </p>
    </main>
  );
}
