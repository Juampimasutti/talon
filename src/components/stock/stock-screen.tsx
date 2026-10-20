"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { formatQty, parseLocaleNumber } from "@/lib/format";
import { isBelowMinimum } from "@/lib/stock-rules";
import { useCatalog, useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: string; sku: string; name: string; warehouseId: string; warehouseName: string; quantity: number; minStock: number };

export function StockScreen() {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const debouncedProduct = useDebounced(productQuery);
  const [quantity, setQuantity] = useState("1");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const list = useQuery({
    queryKey: ["stock", me.data?.company.id, debounced, warehouseId],
    enabled: Boolean(me.data),
    placeholderData: keepPreviousData,
    queryFn: () => apiGet<{ items: Row[] }>(`/api/stock?q=${encodeURIComponent(debounced)}&pageSize=80${warehouseId ? `&warehouseId=${warehouseId}` : ""}`),
  });
  const hits = useQuery({
    queryKey: ["stock-buscar", debouncedProduct, me.data?.company.id],
    enabled: debouncedProduct.trim().length > 1,
    queryFn: () => apiGet<{ items: { id: string; sku: string; name: string }[] }>(`/api/articulos?q=${encodeURIComponent(debouncedProduct)}&pageSize=8`),
  });
  const canAdjust = me.data ? can(me.data.permissions, "stock", "crear") : false;

  async function adjust(event: React.FormEvent) {
    event.preventDefault();
    if (!productId) {
      toast.error("Elegí un artículo");
      return;
    }
    try {
      const qty = parseLocaleNumber(quantity);
      if (qty == null || qty <= 0) { toast.error("La cantidad tiene que ser mayor a cero"); return; }
      await apiSend("/api/stock/ajustes", "POST", { productId, warehouseId: warehouseId || catalog.data?.warehouses[0]?.id, quantity: qty, direction, note: "Ajuste de mostrador" });
      toast.success("Stock ajustado");
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo ajustar");
    }
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Stock</h1>
        <p className="text-sm text-muted-foreground">Existencias por depósito. Lo que está en rojo no llega al mínimo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" aria-label="Buscar stock" placeholder="Artículo o SKU" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="h-8 rounded-lg border px-2 text-sm" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          <option value="">Todos los depósitos</option>
          {catalog.data?.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/70 text-left">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2">Depósito</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((row) => (
              <tr key={`${row.id}-${row.warehouseId}`} className="cursor-pointer border-t hover:bg-accent/40" onClick={() => { setProductId(row.id); setProductQuery(`${row.sku} · ${row.name}`); setWarehouseId(row.warehouseId); }}>
                <td className="px-3 py-2">{row.sku}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.warehouseName}</td>
                <td className={`px-3 py-2 text-right ${isBelowMinimum(row.quantity, row.minStock) ? "text-destructive" : ""}`}>{formatQty(row.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.items.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">No hay stock para mostrar.</p> : null}
      </div>
      {canAdjust ? (
        <form noValidate onSubmit={adjust} className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="relative grid gap-1">
            <Input
              placeholder="Buscar artículo"
              aria-label="Artículo"
              value={productQuery}
              onChange={(event) => {
                setProductQuery(event.target.value);
                setProductId("");
              }}
            />
            {hits.data?.items.length && !productId ? (
              <ul className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-popover shadow-md">
                {hits.data.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setProductId(item.id);
                        setProductQuery(`${item.sku} · ${item.name}`);
                      }}
                    >
                      {item.sku} · {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Input placeholder="Cantidad" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <select className="h-8 rounded-lg border px-2 text-sm" value={direction} onChange={(event) => setDirection(event.target.value as "in" | "out")}>
            <option value="in">Ingreso</option>
            <option value="out">Salida</option>
          </select>
          <Button type="submit" className="sm:col-span-2">
            Ajustar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
