"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { apiGet } from "@/lib/api/client";
import { can, type ModuleKey } from "@/lib/auth/permissions";
import { countNoun, fiscalNumber, formatDate, formatMoney } from "@/lib/format";
import { useDebounced } from "@/components/use-debounced";
import { useMe } from "@/components/use-me";
import { VirtualTable } from "@/components/virtual-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const META = {
  venta: { title: "Ventas", path: "/ventas", module: "ventas" as ModuleKey, create: "Nueva venta" },
  compra: { title: "Compras", path: "/compras", module: "compras" as ModuleKey, create: "Nueva compra" },
  pedido: { title: "Pedidos", path: "/pedidos", module: "pedidos" as ModuleKey, create: "Nuevo pedido" },
  remito: { title: "Remitos", path: "/remitos", module: "remitos" as ModuleKey, create: "Nuevo remito" },
};

type Row = {
  id: string;
  letter: string | null;
  pointOfSale: number;
  number: number;
  issuedOn: string;
  partyName: string;
  totalCents: number;
  status: string;
  typeCode: string;
  sign: number;
  supplierPos?: number | null;
  supplierNumber?: number | null;
};

export function ListaScreen({ kind }: { kind: keyof typeof META }) {
  const meta = META[kind];
  const me = useMe();
  const router = useRouter();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["documentos", me.data?.company.id, kind, debounced, page],
    enabled: Boolean(me.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<{ items: Row[]; total: number; pageSize: number }>(
        `/api/documentos?kind=${kind}&q=${encodeURIComponent(debounced)}&page=${page}&pageSize=40`,
      ),
  });
  const columns = useMemo(
    () => [
      {
        key: "doc",
        header: "Comprobante",
        cell: (row: Row) => `${row.typeCode} ${row.letter ?? ""} ${fiscalNumber({ kind, pointOfSale: row.pointOfSale, number: row.number, supplierPos: row.supplierPos, supplierNumber: row.supplierNumber })}`.replace(/\s+/g, " "),
      },
      { key: "date", header: "Fecha", className: "hidden sm:block", cell: (row: Row) => formatDate(row.issuedOn) },
      { key: "party", header: "Razón social", className: "truncate", cell: (row: Row) => row.partyName },
      { key: "total", header: "Total", className: "text-right", cell: (row: Row) => formatMoney(row.totalCents * row.sign) },
      { key: "status", header: "Estado", className: "hidden border-l pl-4 md:block", cell: (row: Row) => (row.status === "anulado" ? "Anulado" : "Confirmado") },
    ],
    [kind],
  );
  const openDocument = useCallback((row: Row) => router.push(`${meta.path}/${row.id}`), [router, meta.path]);
  const canCreate = me.data ? can(me.data.permissions, meta.module, "crear") : false;

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl tracking-tight">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{list.data ? countNoun(list.data.total, "comprobante", "comprobantes") : "Buscando…"}</p>
        </div>
        {me.data && (kind === "venta" || kind === "compra") && can(me.data.permissions, meta.module, "exportar") ? (
          <a className="inline-flex h-8 items-center rounded-lg border px-3 text-sm" href={`/api/exportar/${kind === "venta" ? "ventas" : "compras"}?formato=xlsx&q=${encodeURIComponent(debounced)}`}>
            Exportar
          </a>
        ) : null}
        {canCreate ? (
          <Link href={`${meta.path}/nueva`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground">
            {meta.create}
          </Link>
        ) : null}
      </div>
      <Input
        aria-label="Buscar comprobantes"
        placeholder="Cliente, proveedor o CUIT"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      <VirtualTable
        rows={list.data?.items ?? []}
        columns={columns}
        template="180px 110px 1.4fr 130px 110px"
        onRow={openDocument}
        empty={list.isLoading ? "Cargando comprobantes…" : "No hay comprobantes con ese filtro."}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
          Anterior
        </Button>
        <Button variant="outline" disabled={!list.data || page * (list.data.pageSize ?? 40) >= list.data.total} onClick={() => setPage((current) => current + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}
