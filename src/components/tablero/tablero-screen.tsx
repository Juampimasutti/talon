"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet } from "@/lib/api/client";
import { showsAccountCard } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { balancePhrase, formatDate, formatMoney, formatNumber, formatQty } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { ScreenFallback } from "@/components/screen-fallback";

type Dashboard = {
  ventasMesCents: number | null;
  comprasMesCents: number | null;
  cajaCents: number | null;
  deudoresCents: number | null;
  acreedoresCents: number | null;
  recent: {
    id: string;
    kind: string;
    code: string;
    letter: string | null;
    pointOfSale: number;
    number: number;
    partyName: string;
    totalCents: number;
    issuedOn: string;
    status: string;
    sign: number;
  }[];
  lowStock: { id: string; sku: string; name: string; quantity: number; minStock: number }[];
};

const KIND_PATH: Record<string, string> = {
  venta: "/ventas",
  compra: "/compras",
  pedido: "/pedidos",
  remito: "/remitos",
};

export function TableroScreen() {
  const me = useMe();
  const board = useQuery({
    queryKey: ["tablero", me.data?.company.id],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<Dashboard>("/api/tablero"),
  });

  if (!me.data || board.isLoading || !board.data) return <ScreenFallback label="Armando el tablero" />;
  if (board.isError) return <p className="p-6 text-sm">No pude cargar el tablero. Probá de nuevo en un rato.</p>;

  const perms = me.data.permissions;
  const cards = [
    board.data.ventasMesCents != null ? ["Ventas del mes", formatMoney(board.data.ventasMesCents)] : null,
    board.data.comprasMesCents != null ? ["Compras del mes", formatMoney(board.data.comprasMesCents)] : null,
    board.data.cajaCents != null ? ["Saldo de caja", formatMoney(board.data.cajaCents)] : null,
    showsAccountCard(perms, "clientes") && board.data.deudoresCents != null ? ["Clientes", balancePhrase("cliente", board.data.deudoresCents)] : null,
    showsAccountCard(perms, "proveedores") && board.data.acreedoresCents != null ? ["Proveedores", balancePhrase("proveedor", board.data.acreedoresCents)] : null,
  ].filter((item): item is [string, string] => Boolean(item));
  const seeDocuments = ["ventas", "compras", "pedidos", "remitos"].some((module) => can(perms, module, "ver"));

  return (
    <div className="grid gap-5 p-4 md:p-5 xl:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Tablero general</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[me.data.company.city, me.data.company.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        {can(perms, "ventas", "crear") ? (
          <Link href="/ventas/nueva" className="inline-flex h-8 items-center gap-2 rounded-lg border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <span aria-hidden="true">+</span> Nueva venta
          </Link>
        ) : null}
      </header>
      <section aria-label="Resumen de saldos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <article key={label} className="talon-metric">
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <p className={label === "Clientes" || label === "Proveedores" ? "talon-metric-value talon-metric-balance" : "talon-metric-value"}>{value}</p>
          </article>
        ))}
      </section>
      {seeDocuments ? (
        <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <h2 className="talon-panel-title">Últimos comprobantes</h2>
          {board.data.recent.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Todavía no hay movimientos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="talon-data-table">
                <caption className="sr-only">Últimos comprobantes de la empresa</caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Comprobante</th>
                    <th scope="col">Cliente / proveedor</th>
                    <th scope="col" className="text-right">Importe</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {board.data.recent.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-muted-foreground">{formatDate(row.issuedOn)}</td>
                      <td className="whitespace-nowrap">
                        <Link href={`${KIND_PATH[row.kind] ?? "/ventas"}/${row.id}`} className="talon-row-link font-medium text-primary">
                          {row.code} {row.letter ?? ""} {formatNumber(row.pointOfSale, row.number)}
                        </Link>
                      </td>
                      <td className="min-w-40">{row.partyName}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(row.totalCents * row.sign)}</td>
                      <td>
                        <span className={`talon-state ${row.status === "anulado" ? "text-destructive!" : ""}`}>
                          {row.status === "anulado" ? "Anulado" : "Confirmado"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      {can(perms, "stock", "ver") ? (
        <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <h2 className="talon-panel-title">Artículos bajo mínimo</h2>
          {board.data.lowStock.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Ningún artículo está bajo el mínimo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="talon-data-table">
                <caption className="sr-only">Artículos con stock inferior al mínimo configurado</caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Artículo</th>
                    <th scope="col" className="text-right">Stock</th>
                    <th scope="col" className="text-right">Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {board.data.lowStock.map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted-foreground">{row.sku}</td>
                      <td>{row.name}</td>
                      <td className="text-right font-semibold text-[var(--talon-warning)] tabular-nums">{formatQty(row.quantity)}</td>
                      <td className="text-right tabular-nums">{formatQty(row.minStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
