"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { formatMoney, parseMoneyToCents } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type List = { id: string; name: string; isDefault: boolean };
type Item = { product_id: string; sku: string; name: string; price_cents: string | null };

export function ListasScreen() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const data = useQuery({
    queryKey: ["listas", listId, q, page],
    queryFn: () => apiGet<{ lists: List[]; items: Item[]; total: number; page: number; pageSize: number; listId: string; canEdit: boolean; canCreate: boolean }>(`/api/listas?lista=${listId}&q=${encodeURIComponent(q)}&page=${page}&pageSize=40`),
  });
  const lists = data.data?.lists ?? [];
  const selected = listId || data.data?.listId || lists.find((list) => list.isDefault)?.id || lists[0]?.id || "";
  const rows = data.data?.items ?? [];
  const pageSize = data.data?.pageSize ?? 40;
  const total = data.data?.total ?? 0;

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Listas de precios</h1>
        <p className="text-sm text-muted-foreground">Cada cliente puede tener la suya. La venta toma la lista de la ficha, o la que elijas en el comprobante.</p>
      </div>
      {data.data?.canCreate ? (
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) { toast.error("Poné el nombre de la lista"); return; }
          void apiSend("/api/listas", "POST", { name }).then(async () => { toast.success("Lista creada"); setName(""); await queryClient.invalidateQueries({ queryKey: ["listas"] }); }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo crear"));
        }}>
          <Input aria-label="Nombre de la lista" placeholder="Nombre de la lista" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="outline">Nueva lista</Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1 text-sm">
          Lista
          <select className="h-8 rounded-lg border px-2" value={selected} onChange={(event) => { setListId(event.target.value); setPage(1); }}>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{list.isDefault ? " · predeterminada" : ""}</option>)}
          </select>
        </label>
        {data.data?.canEdit && selected ? (
          <Button variant="outline" onClick={() => void apiSend(`/api/listas/${selected}`, "PATCH", { isDefault: true }).then(async () => { toast.success("Lista predeterminada"); await queryClient.invalidateQueries({ queryKey: ["listas"] }); await queryClient.invalidateQueries({ queryKey: ["catalogos"] }); }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo"))}>
            Usar como predeterminada
          </Button>
        ) : null}
      </div>
      <table className="w-full text-sm">
        <thead><tr><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Artículo</th><th className="p-2 text-left">Precio</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.product_id} className="border-t">
              <td className="p-2">{row.sku}</td>
              <td className="p-2">{row.name}</td>
              <td className="p-2">{row.price_cents ? formatMoney(Number(row.price_cents)) : "Sin precio"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{q ? "Ningún artículo coincide." : "Todavía no hay artículos."}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input aria-label="Buscar artículo" placeholder="Buscar SKU o nombre" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} />
        <span>{total} artículos</span>
        <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button>
        <Button type="button" variant="outline" disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
      </div>
      {data.data?.canEdit && selected ? (
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const priceCents = parseMoneyToCents(price);
          if (!sku.trim() || priceCents == null) { toast.error("Completá el SKU y un precio válido"); return; }
          const known = rows.find((row) => row.sku.toLowerCase() === sku.trim().toLowerCase());
          const save = (id: string) => apiSend(`/api/listas/${selected}/precios`, "POST", { productId: id, priceCents }).then(async () => { toast.success("Precio guardado"); setSku(""); setPrice(""); await queryClient.invalidateQueries({ queryKey: ["listas"] }); });
          if (known) {
            void save(known.product_id).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo guardar"));
            return;
          }
          void apiGet<{ items: { id: string; sku: string }[] }>(`/api/articulos?q=${encodeURIComponent(sku.trim())}&exact=1&pageSize=5`).then((found) => {
            const hit = found.items.find((item) => item.sku.toLowerCase() === sku.trim().toLowerCase());
            if (!hit) { toast.error("No encontré ese SKU. Buscalo en el listado o importalo desde Datos."); return; }
            return save(hit.id);
          }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo guardar"));
        }}>
          <Input aria-label="SKU" placeholder="SKU" value={sku} onChange={(event) => setSku(event.target.value)} />
          <Input aria-label="Precio" placeholder="Precio" value={price} onChange={(event) => setPrice(event.target.value)} />
          <Button type="submit">Guardar precio</Button>
        </form>
      ) : null}
      <p className="text-sm text-muted-foreground">Para cargar muchos precios, usá Datos → Listas de precios. En la ficha del cliente se elige la lista, y la venta la aplica.</p>
    </div>
  );
}
