"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: string; action: string; summary: string; createdAt: string; userName: string | null };

function readableMoney(summary: string): string {
  return summary.replace(/Arqueo (\d+) contra (\d+)/, (_match, counted: string, expected: string) => `Arqueo ${formatMoney(Number(counted))} contra ${formatMoney(Number(expected))}`);
}

export function AuditoriaScreen() {
  const me = useMe();
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState("");
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ["auditoria", me.data?.company.id, q, accion, page],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<{ items: Row[]; total: number; pageSize: number }>(`/api/auditoria?page=${page}&pageSize=40&q=${encodeURIComponent(q)}&accion=${encodeURIComponent(accion)}`),
  });
  const total = log.data?.total ?? 0;
  const pageSize = log.data?.pageSize ?? 40;
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-3xl tracking-tight sm:text-4xl">Auditoría</h1>
        <p className="text-sm text-muted-foreground">Quién hizo qué, en esta empresa.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Buscar en el texto" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} />
        <Input className="w-40" placeholder="Acción" value={accion} onChange={(event) => { setAccion(event.target.value); setPage(1); }} />
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {log.data?.items.map((row) => (
          <li key={row.id} className="px-4 py-3 text-sm">
            <p>{readableMoney(row.summary)}</p>
            <p className="text-muted-foreground">
              {row.userName ?? "Alguien"} · {formatDateTime(row.createdAt)} · {row.action}
            </p>
          </li>
        ))}
      </ul>
      {log.data && log.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No hay movimientos con ese filtro.</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
        <span className="text-sm text-muted-foreground">{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
        <Button variant="outline" disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
