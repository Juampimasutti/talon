"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { formatCuit } from "@/lib/fiscal/cuit";
import { PROVINCES, TAX_CONDITION_LABELS, taxConditionLabel } from "@/lib/fiscal/labels";
import { countNoun, formatMoney, parseLocaleNumber, parseMoneyToCents } from "@/lib/format";
import { useCatalog, useMe } from "@/components/use-me";
import { useDebounced } from "@/components/use-debounced";
import { VirtualTable } from "@/components/virtual-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Party = {
  id: string;
  code: string;
  name: string;
  fantasyName: string | null;
  cuit: string | null;
  docType: string;
  taxCondition: string;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  priceListId?: string | null;
  discountBps?: number;
  creditLimitCents?: number;
  iibbPerceptionBps?: number | null;
  paymentTermsDays?: number;
  contact?: string | null;
  postalCode?: string | null;
  iibb?: string | null;
  zone?: string | null;
};

const empty = {
  name: "",
  fantasyName: "",
  docType: "CUIT",
  cuit: "",
  taxCondition: "ri",
  city: "Paraná",
  province: "Entre Ríos",
  phone: "",
  email: "",
  address: "",
  notes: "",
  active: true,
  priceListId: "" as string,
  discountBps: "0",
  creditLimit: "",
  perception: "",
  contact: "",
};

export function DirectorioScreen({ kind }: { kind: "clientes" | "proveedores" }) {
  const me = useMe();
  const catalog = useCatalog(me.data?.company.id);
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [urlQuery, setUrlQuery] = useState(() => params.get("q"));
  if (urlQuery !== params.get("q")) {
    setUrlQuery(params.get("q"));
    if (params.get("q")) setQ(params.get("q")!);
  }
  const debounced = useDebounced(q);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [form, setForm] = useState(empty);
  const [pending, setPending] = useState(false);
  const entity = kind === "clientes" ? "cliente" : "proveedor";
  const moduleKey = kind === "clientes" ? "clientes" : "proveedores";

  const list = useQuery({
    queryKey: [kind, me.data?.company.id, debounced, page],
    enabled: Boolean(me.data),
    placeholderData: keepPreviousData,
    queryFn: () => apiGet<{ items: Party[]; total: number; pageSize: number }>(`/api/${kind}?q=${encodeURIComponent(debounced)}&page=${page}&pageSize=60`),
  });

  const columns = useMemo(
    () => [
      { key: "code", header: "Código", className: "w-full truncate", cell: (row: Party) => row.code },
      { key: "name", header: "Nombre", className: "truncate", cell: (row: Party) => row.name },
      { key: "cuit", header: "CUIT", cell: (row: Party) => (row.cuit ? formatCuit(row.cuit) : "—") },
      { key: "iva", header: "IVA", className: "hidden md:block", cell: (row: Party) => taxConditionLabel(row.taxCondition) },
      { key: "city", header: "Localidad", className: "hidden lg:block", cell: (row: Party) => row.city ?? "—" },
    ],
    [],
  );

  function openNew() {
    setEditing(null);
    setForm({ ...empty, priceListId: catalog.data?.priceLists.find((list) => list.isDefault)?.id ?? "" });
    setOpen(true);
  }

  const openEdit = useCallback((row: Party) => {
    setEditing(row);
    setForm({
      ...empty,
      name: row.name,
      fantasyName: row.fantasyName ?? "",
      docType: row.docType,
      cuit: row.cuit ?? "",
      taxCondition: row.taxCondition,
      city: row.city ?? "",
      province: row.province ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      address: row.address ?? "",
      notes: row.notes ?? "",
      active: row.active,
      priceListId: row.priceListId ?? "",
      discountBps: String((row.discountBps ?? 0) / 100),
      creditLimit: row.creditLimitCents ? String(row.creditLimitCents / 100) : "",
      perception: row.iibbPerceptionBps ? String(row.iibbPerceptionBps / 100) : "",
      contact: row.contact ?? "",
    });
    setOpen(true);
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) { toast.error("Poné el nombre"); return; }
    setPending(true);
    const payload = {
      name: form.name,
      fantasyName: form.fantasyName,
      docType: form.docType,
      cuit: form.cuit,
      taxCondition: form.taxCondition,
      city: form.city,
      province: form.province,
      phone: form.phone,
      email: form.email,
      address: form.address,
      notes: form.notes,
      active: form.active,
      contact: form.contact,
      priceListId: form.priceListId || null,
      discountBps: Math.round((parseLocaleNumber(form.discountBps || "0") ?? 0) * 100),
      creditLimitCents: parseMoneyToCents(form.creditLimit || "0") ?? 0,
      iibbPerceptionBps: form.perception ? Math.round((parseLocaleNumber(form.perception) ?? 0) * 100) : null,
      customFields: [],
    };
    try {
      if (editing) await apiSend(`/api/${kind}/${editing.id}`, "PATCH", payload);
      else await apiSend(`/api/${kind}`, "POST", payload);
      toast.success(editing ? "Ficha actualizada" : "Ficha creada");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: [kind] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo guardar");
    } finally {
      setPending(false);
    }
  }

  const canCreate = me.data ? can(me.data.permissions, moduleKey, "crear") : false;
  const canEdit = me.data ? can(me.data.permissions, moduleKey, "editar") : false;
  const title = kind === "clientes" ? "Clientes" : "Proveedores";

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{list.data ? countNoun(list.data.total, "ficha", "fichas") : "Buscando…"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.data && can(me.data.permissions, moduleKey, "exportar") ? (
            <a className="inline-flex h-8 items-center rounded-lg border px-3 text-sm" href={`/api/exportar/${kind}?formato=xlsx&q=${encodeURIComponent(debounced)}`}>
              Exportar
            </a>
          ) : null}
          {canCreate ? <Button onClick={openNew}>Nueva ficha</Button> : null}
        </div>
      </div>
      <Input
        aria-label={`Buscar ${title.toLowerCase()}`}
        placeholder="Buscá por nombre, CUIT o código"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      <VirtualTable
        rows={list.data?.items ?? []}
        columns={columns}
        template="90px 1.4fr 140px 160px 140px"
        onRow={canEdit ? openEdit : undefined}
        empty={list.isLoading ? "Cargando…" : `No hay ${title.toLowerCase()} con esa búsqueda.`}
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
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar ${entity}` : `Nuevo ${entity}`}</DialogTitle>
          </DialogHeader>
          {editing && me.data && can(me.data.permissions,"auditoria","ver") ? <a className="text-sm text-primary underline" href={`/auditoria?entidad=${kind}&registro=${editing.id}`}>Ver historial de esta ficha</a> : null}
          <form noValidate onSubmit={save} className="grid gap-3">
            <Field label="Nombre">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Documento">
                <select className="h-8 rounded-lg border px-2 text-sm" value={form.docType} onChange={(event) => setForm({ ...form, docType: event.target.value })}>
                  <option value="CUIT">CUIT</option>
                  <option value="DNI">DNI</option>
                  <option value="OTRO">Otro</option>
                </select>
              </Field>
              <Field label="Número">
                <Input value={form.cuit} onChange={(event) => setForm({ ...form, cuit: event.target.value })} placeholder="20-12345678-6" />
              </Field>
            </div>
            <Field label="Condición frente al IVA">
              <select className="h-8 rounded-lg border px-2 text-sm" value={form.taxCondition} onChange={(event) => setForm({ ...form, taxCondition: event.target.value })}>
                {TAX_CONDITION_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Localidad">
                <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
              </Field>
              <Field label="Provincia">
                <select className="h-8 rounded-lg border px-2 text-sm" value={form.province} onChange={(event) => setForm({ ...form, province: event.target.value })}>
                  {PROVINCES.map((province) => (
                    <option key={province}>{province}</option>
                  ))}
                </select>
              </Field>
            </div>
            {kind === "clientes" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Lista de precios">
                  <select className="h-8 rounded-lg border px-2 text-sm" value={form.priceListId} onChange={(event) => setForm({ ...form, priceListId: event.target.value })}>
                    <option value="">Sin lista</option>
                    {catalog.data?.priceLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Límite de crédito">
                  <Input value={form.creditLimit} onChange={(event) => setForm({ ...form, creditLimit: event.target.value })} placeholder="250000" />
                </Field>
                <Field label="Descuento %">
                  <Input value={form.discountBps} onChange={(event) => setForm({ ...form, discountBps: event.target.value })} />
                </Field>
                <Field label="Percepción IIBB %">
                  <Input value={form.perception} onChange={(event) => setForm({ ...form, perception: event.target.value })} placeholder="3" />
                </Field>
              </div>
            ) : null}
            <Field label="Teléfono">
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
              Activo
            </label>
            {editing?.creditLimitCents ? <p className="text-sm text-muted-foreground">Límite actual {formatMoney(editing.creditLimitCents)}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <Label>{label}</Label>
      {children}
    </label>
  );
}
