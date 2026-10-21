"use client";
import { useState } from "react";
import { toast } from "sonner";
import { apiSend } from "@/lib/api/client";
import { formatMoney, parseLocaleNumber, todayIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Row = Record<string, string | number | boolean | null>;
type Preview = {
  periodBaseCents: number;
  adjustmentCents: number;
  advanceReturnedCents: number;
  repairCents: number;
  taxBaseCents: number;
  vatCents: number;
  totalCents: number;
  progressBps: number;
  perceptionsCents: number;
};
export function CertificateForm({
  work,
  items,
  onDone,
  onCancel,
}: {
  work: Row;
  items: Row[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [issuedOn, setDate] = useState(todayIso());
  const [index, setIndex] = useState("");
  const [indexMonth, setIndexMonth] = useState(todayIso().slice(0, 7));
  const [source, setSource] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        String(item.id),
        String(
          item.global_item
            ? Number(item.certified_bps) / 100
            : Number(item.certified_quantity_milli) / 1000,
        ),
      ]),
    ),
  );
  const [preview, setPreview] = useState<{
    data: Preview;
    body: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  function body() {
    return {
      workId: work.id,
      period,
      issuedOn,
      cacIndex: index ? parseLocaleNumber(index) : undefined,
      cacMonth: work.cac_base_index ? indexMonth : undefined,
      cacSource: source,
      items: items.map((item) => ({
        itemId: item.id,
        ...(item.global_item
          ? {
              cumulativeBps: Math.round(
                (parseLocaleNumber(values[String(item.id)]) ?? -1) * 100,
              ),
            }
          : {
              cumulativeQuantity:
                parseLocaleNumber(values[String(item.id)]) ?? -1,
            }),
      })),
    };
  }
  async function calculate() {
    setPending(true);
    try {
      const input = body();
      const data = await apiSend<Preview>(
        "/api/constructora/previsualizacion",
        "POST",
        input,
      );
      setPreview({ data, body: JSON.stringify(input) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo calcular");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="grid gap-3 rounded border bg-card p-4"
      onChange={() => setPreview(null)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!preview || preview.body !== JSON.stringify(body())) {
          toast.error("Calculá el certificado antes de emitir");
          return;
        }
        setPending(true);
        try {
          await apiSend("/api/constructora/certificados", "POST", body());
          toast.success("Certificado emitido y facturado");
          await onDone();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "No se pudo emitir",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <h2 className="font-semibold">Certificar por cantidades · {work.name}</h2>
      <p className="text-sm text-muted-foreground">
        Cargá lo ejecutado acumulado. El sistema resta lo ya certificado; el
        avance total sólo informa. Para superar un ítem hay que crear un
        adicional.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Período
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Fecha de emisión
          <Input
            type="date"
            value={issuedOn}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      {work.cac_base_index ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            Mes del índice CAC
            <Input
              type="month"
              value={indexMonth}
              onChange={(e) => setIndexMonth(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Índice CAC del mes
            <Input
              inputMode="decimal"
              value={index}
              onChange={(e) => setIndex(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Fuente del índice
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Rubro / ítem</th>
              <th className="p-2">Pactado</th>
              <th className="p-2">Ya certificado</th>
              <th className="p-2">Acumulado ejecutado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={String(item.id)} className="border-b">
                <td className="p-2">
                  {item.rubro} · {item.description}
                  {item.additional ? " · Adicional" : ""}
                </td>
                <td className="p-2">
                  {item.global_item
                    ? "Global (1)"
                    : Number(item.quantity_milli) / 1000}{" "}
                  · {formatMoney(Number(item.unit_price_cents))}
                </td>
                <td className="p-2">
                  {item.global_item
                    ? `${Number(item.certified_bps) / 100}%`
                    : Number(item.certified_quantity_milli) / 1000}
                </td>
                <td className="p-2">
                  <Input
                    aria-label={`Acumulado ${item.description}${item.global_item ? " (%)" : ""}`}
                    inputMode="decimal"
                    value={values[String(item.id)]}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [String(item.id)]: e.target.value,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview ? (
        <section className="grid max-w-lg gap-1 rounded border p-3 text-sm">
          {[
            ["Certificado básico", preview.data.periodBaseCents],
            ["Ajuste CAC", preview.data.adjustmentCents],
            [
              "Devolución proporcional del anticipo",
              -preview.data.advanceReturnedCents,
            ],

            ["Neto a facturar", preview.data.taxBaseCents],
            ["IVA", preview.data.vatCents],
            ["Percepciones fiscales", preview.data.perceptionsCents],
            ["Total factura", preview.data.totalCents],
            [
              "Fondo de reparo retenido (sin reducir IVA)",
              preview.data.repairCents,
            ],
            [
              "A cobrar ahora",
              preview.data.totalCents - preview.data.repairCents,
            ],
          ].map(([label, value]) => (
            <p className="flex justify-between gap-3" key={String(label)}>
              <span>{label}</span>
              <strong className="tabular-nums">
                {formatMoney(Number(value))}
              </strong>
            </p>
          ))}
          <p className="border-t pt-2">
            Avance informativo:{" "}
            {(preview.data.progressBps / 100).toLocaleString("es-AR")}%
          </p>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending || !items.length}
          onClick={calculate}
        >
          Calcular certificado
        </Button>
        <Button type="submit" disabled={pending || !preview}>
          {pending ? "Procesando…" : "Emitir y facturar"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
