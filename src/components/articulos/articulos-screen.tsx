"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { IVA_RATES, rateLabel } from "@/lib/fiscal/labels";
import { formatMoney, formatQty, parseLocaleNumber, parseMoneyToCents } from "@/lib/format";
import { useCatalog, useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { VirtualTable } from "@/components/virtual-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Product = {
  id: string;
  sku: string;
  name: string;
  ivaRateBps: number;
  costCents: number;
  minStock: number;
  tracksStock: boolean;
  active: boolean;
  unit: string;
  taxTreatment: string;
  categoryId: string | null;
  listPriceCents: number | null;
};

export function ArticulosScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", cost: "", price: "", iva: "2100", categoryId: "", tracksStock: true, minStock: "0" });
  const defaultList = catalog.data?.priceLists.find((list) => list.isDefault)?.id;

  const list = useQuery({
    queryKey: ["articulos", me.data?.company.id, debounced, page, defaultList],
    enabled: Boolean(me.data && catalog.isFetched),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<{ items: Product[]; total: number; pageSize: number }>(
        `/api/articulos?q=${encodeURIComponent(debounced)}&page=${page}&pageSize=80${defaultList ? `&priceListId=${defaultList}` : ""}`,
      ),
  });

  const columns = useMemo(
    () => [
      { key: "sku", header: "SKU", cell: (row: Product) => row.sku },
      { key: "name", header: "Artículo", className: "truncate", cell: (row: Product) => row.name },
      { key: "iva", header: "IVA", className: "hidden sm:block", cell: (row: Product) => rateLabel(row.ivaRateBps) },
      { key: "cost", header: "Costo", className: "text-right", cell: (row: Product) => formatMoney(row.costCents) },
      { key: "price", header: "Lista predeterminada", className: "hidden text-right md:block", cell: (row: Product) => (row.listPriceCents == null ? "—" : formatMoney(row.listPriceCents)) },
      { key: "min", header: "Mín.", className: "hidden text-right lg:block", cell: (row: Product) => (row.tracksStock ? formatQty(Number(row.minStock)) : "—") },
    ],
    [],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.sku.trim() || !form.name.trim()) { toast.error("Completá el código y la descripción"); return; }
    if (!defaultList) {
      toast.error("Primero necesitás una lista de precios");
      return;
    }
    setPending(true);
    try {
      await apiSend(editingId ? `/api/articulos/${editingId}` : "/api/articulos", editingId ? "PATCH" : "POST", {
        sku: form.sku,
        name: form.name,
        costCents: (() => {
          const cents = form.cost.trim() ? parseMoneyToCents(form.cost) : 0;
          if (cents == null) throw new Error("El costo no puede ser negativo");
          return cents;
        })(),
        ivaRateBps: Number(form.iva),
        categoryId: form.categoryId || null,
        tracksStock: form.tracksStock,
        minStock: parseLocaleNumber(form.minStock || "0") ?? 0,
        prices: [{ priceListId: defaultList, priceCents: (() => {
          const cents = form.price.trim() ? parseMoneyToCents(form.price) : 0;
          if (cents == null) throw new Error("El precio no puede ser negativo");
          return cents;
        })() }],
      });
      toast.success(editingId ? "Artículo actualizado" : "Artículo cargado");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["articulos"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setPending(false);
    }
  }

  const canCreate = me.data ? can(me.data.permissions, "articulos", "crear") : false;

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl tracking-tight">Artículos</h1>
          <p className="text-sm text-muted-foreground">
            {list.data ? `${list.data.total} en el padrón` : "Buscando…"} · se pintan solo las filas visibles
          </p>
        </div>
        {canCreate ? (
          <Button
            onClick={() => {
              setEditingId(null);
              setForm({ sku: "", name: "", cost: "", price: "", iva: "2100", categoryId: "", tracksStock: true, minStock: "0" });
              setOpen(true);
            }}
          >
            Nuevo artículo
          </Button>
        ) : null}
      </div>
      <Input
        aria-label="Buscar artículos"
        placeholder="Nombre, SKU o código de barras"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      <VirtualTable
        rows={list.data?.items ?? []}
        columns={columns}
        template="120px 1.6fr 70px 120px 120px 70px"
        empty={list.isLoading ? "Cargando artículos…" : "Ningún artículo coincide."}
        onRow={me.data && can(me.data.permissions, "articulos", "editar") ? (row) => {
          setEditingId(row.id);
          setForm({
            sku: row.sku,
            name: row.name,
            cost: String(row.costCents / 100),
            price: row.listPriceCents == null ? "" : String(row.listPriceCents / 100),
            iva: String(row.ivaRateBps),
            categoryId: row.categoryId ?? "",
            tracksStock: row.tracksStock,
            minStock: String(row.minStock),
          });
          setOpen(true);
        } : undefined}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
          Anterior
        </Button>
        <Button variant="outline" disabled={!list.data || page * list.data.pageSize >= list.data.total} onClick={() => setPage((current) => current + 1)}>
          Siguiente
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar artículo" : "Nuevo artículo"}</DialogTitle>
          </DialogHeader>
          <form noValidate onSubmit={save} className="grid gap-3">
            <Input placeholder="SKU" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            <Input placeholder="Descripción" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Costo" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
              <Input placeholder="Precio de lista" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
            </div>
            <select className="h-8 rounded-lg border px-2 text-sm" value={form.iva} onChange={(event) => setForm({ ...form, iva: event.target.value })}>
              {IVA_RATES.map((rate) => (
                <option key={rate.bps} value={rate.bps}>
                  IVA {rate.label}
                </option>
              ))}
            </select>
            <select className="h-8 rounded-lg border px-2 text-sm" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Sin rubro</option>
              {catalog.data?.categories
                .filter((category) => category.kind === "articulo")
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <Input placeholder="Stock mínimo" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.tracksStock} onChange={(event) => setForm({ ...form, tracksStock: event.target.checked })} />
              Controla stock
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
