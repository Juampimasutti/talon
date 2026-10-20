"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { can } from "@/lib/auth/permissions";
import { useMe } from "@/components/use-me";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { formatMoney, parseMoneyToCents, todayIso } from "@/lib/format";
import { acceptToast } from "@/lib/ui/toast-once";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EntityInfo = { key: string; label: string; canImport: boolean; canExport: boolean };
type PreviewRow = { rowNumber: number; values: Record<string, string>; errors: string[]; warnings: string[]; duplicate: boolean; missingIva: boolean };
type Summary = { total?: number; errors?: number; warnings?: number; duplicates?: number; missingIva?: number; created?: number; updated?: number; skipped?: number; failed?: number; messages?: string[] };
type Field = { key: string; label: string };

const PreviewLine = memo(function PreviewLine({ row }: { row: PreviewRow }) {
  const tone = row.errors.length ? "text-destructive" : row.warnings.length ? "text-amber-800" : "text-foreground";
  const name = row.values.nombre || row.values.sku || row.values.codigo || "Fila";
  return (
    <div className={`grid grid-cols-[70px_1fr_1.4fr] gap-2 border-b px-3 py-2 text-sm ${tone}`}>
      <span>{row.rowNumber}</span>
      <span className="truncate">{name}</span>
      <span className="truncate">{row.errors[0] || row.warnings[0] || "Lista para entrar"}</span>
    </div>
  );
});

export function DatosScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ["importar-entidades", me.data?.company.id],
    enabled: Boolean(me.data),
    staleTime: 60_000,
    queryFn: () => apiGet<{ entities: EntityInfo[]; canBackup: boolean; canRestore: boolean }>("/api/importar/entidades"),
  });
  const jobs = useQuery({
    queryKey: ["importar-trabajos", me.data?.company.id],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<{ jobs: { id: string; entity: string; filename: string; status: string; summary: Summary; user_id?: string }[] }>("/api/importar/trabajos"),
  });
  const [entity, setEntity] = useState("clientes");
  const [delimiter, setDelimiter] = useState("auto");
  const [widths, setWidths] = useState("11,30,20");
  const [busy, setBusy] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [ensayo, setEnsayo] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Field[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<"omitir" | "actualizar" | "crear">("omitir");
  const [ivaMode, setIvaMode] = useState<"regla" | "bloque" | "manual">("regla");
  const [ivaBloque, setIvaBloque] = useState("cf");
  const [templateName, setTemplateName] = useState("");
  const [result, setResult] = useState<Summary | null>(null);

  const entities = info.data?.entities ?? [];
  const current = entities.find((item) => item.key === entity) ?? entities[0];

  async function upload(file: File) {
    setBusy("Leyendo el archivo…");
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    form.set("entity", entity);
    form.set("delimiter", delimiter);
    form.set("widths", widths);
    try {
      const response = await fetch("/api/importar/analizar", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new ApiError(body.error ?? "No se pudo leer", response.status);
      setJobId(body.data.jobId);
      setColumns(body.data.columns);
      setMapping(body.data.mapping);
      setFields(body.data.fields);
      setSummary(body.data.summary);
      setPreview(body.data.preview);
      toast.success(body.data.profile ? "Detectamos un archivo de Mis Comprobantes" : "Archivo leído");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo leer el archivo");
    } finally {
      setBusy("");
    }
  }

  async function applyMap() {
    if (!jobId) return;
    setBusy("Revisando las columnas…");
    try {
      const data = await apiSend<{ summary: Summary; preview: PreviewRow[] }>(`/api/importar/trabajos/${jobId}/mapear`, "POST", {
        mapping,
        saveAs: templateName || undefined,
      });
      setSummary(data.summary);
      setPreview(data.preview);
      toast.success("Mapeo actualizado");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo mapear");
    } finally {
      setBusy("");
    }
  }

  async function confirmImport() {
    if (!jobId) return;
    setBusy("Importando por lotes…");
    try {
      const data = await apiSend<Summary>(`/api/importar/trabajos/${jobId}/confirmar`, "POST", { duplicateMode, ivaMode, ivaBloque });
      setResult(data);
      setPreview([]);
      setJobId(null);
      setSummary(null);
      toast.success(`Importación confirmada. Creadas ${data.created ?? 0}, actualizadas ${data.updated ?? 0}, omitidas ${data.skipped ?? 0}${data.failed ? `, con error ${data.failed}` : ""}.`);
      await queryClient.invalidateQueries({ queryKey: ["importar-trabajos"] });
      await queryClient.invalidateQueries({ queryKey: ["clientes"] });
      await queryClient.invalidateQueries({ queryKey: ["articulos"] });
      await queryClient.invalidateQueries({ queryKey: ["documentos"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo importar");
    } finally {
      setBusy("");
    }
  }

  async function undoJob(id: string) {
    try {
      await apiSend(`/api/importar/trabajos/${id}/deshacer`, "POST");
      toast.success("Importación deshecha");
      await queryClient.invalidateQueries({ queryKey: ["importar-trabajos"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo deshacer");
    }
  }

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: preview.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 6,
  });
  const mappedCount = useMemo(() => Object.values(mapping).filter(Boolean).length, [mapping]);

  return (
    <div className="grid gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Datos</h1>
        <p className="text-sm text-muted-foreground">Importá Excel, CSV o TXT. Nada se graba hasta que confirmás. La exportación respeta el filtro del listado.</p>
      </div>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="text-xl">Exportar</h2>
        <div className="flex flex-wrap gap-2">
          {entities.filter((item) => item.canExport).map((item) => (
            <a key={item.key} className="rounded-full border px-3 py-1 text-sm hover:bg-accent" href={`/api/exportar/${item.key}?formato=xlsx`}>
              {item.label} .xlsx
            </a>
          ))}
          {info.data?.canBackup ? (
            <a className="rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground" href="/api/exportar/backup?formato=xlsx" download>
              Backup de la empresa
            </a>
          ) : null}
        </div>
      </section>

      {current?.canImport ? (
        <section className="grid gap-4 rounded-xl border bg-card p-4">
          <h2 className="text-xl">Importar</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              Qué vas a cargar
              <select className="h-9 rounded-lg border px-2" value={entity} onChange={(event) => { setEntity(event.target.value); setJobId(null); }}>
                {entities.filter((item) => item.canImport).map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
                {info.data?.canRestore ? <option value="backup">Backup completo</option> : null}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Separador
              <select className="h-9 rounded-lg border px-2" value={delimiter} onChange={(event) => setDelimiter(event.target.value)}>
                <option value="auto">Detectar solo</option>
                <option value="semicolon">Punto y coma</option>
                <option value="comma">Coma</option>
                <option value="tab">Tabulación</option>
                <option value="fixed">Ancho fijo</option>
              </select>
            </label>
            {delimiter === "fixed" ? (
              <label className="grid gap-1 text-sm">
                Anchos
                <Input value={widths} onChange={(event) => setWidths(event.target.value)} />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {entity !== "backup" ? (
              <>
                <a className="text-sm underline" href={`/api/importar/plantilla/${entity}?formato=csv`}>Plantilla CSV</a>
                <a className="text-sm underline" href={`/api/importar/plantilla/${entity}?formato=xlsx`}>Plantilla Excel</a>
              </>
            ) : null}
            <label className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              Subir archivo
              <input
                className="sr-only"
                type="file"
                accept=".csv,.txt,.xlsx,.xls,.dbf,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const stem = file.name.replace(/\.[^.]+$/, "").toUpperCase();
                  const known: Record<string, string> = { CLIENTES: "clientes", PROVEEDO: "proveedores", ARTICULO: "articulos", LISTAPRE: "listas", CUENTAS: "plan" };
                  if (known[stem]) setEntity(known[stem]);
                  void upload(file);
                }}
              />
            </label>
            {busy ? <span className="text-sm text-muted-foreground">{busy}</span> : null}
          </div>

          {jobId && summary ? (
            <div className="grid gap-4">
              <p className="text-sm">
                {summary.total ?? 0} filas · {summary.errors ?? 0} con error · {summary.duplicates ?? 0} duplicadas · {summary.missingIva ?? 0} sin condición de IVA · {mappedCount} columnas mapeadas
              </p>
              <div className="grid gap-2">
                {columns.map((column) => (
                  <label key={column} className="grid items-center gap-2 text-sm md:grid-cols-[1fr_1fr]">
                    <span className="truncate">{column}</span>
                    <select className="h-8 rounded-lg border px-2" value={mapping[column] ?? ""} onChange={(event) => setMapping({ ...mapping, [column]: event.target.value })}>
                      <option value="">No importar</option>
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>{field.label}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-xs" placeholder="Nombre para guardar el mapeo" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
                <Button variant="outline" onClick={() => void applyMap()}>Aplicar mapeo</Button>
              </div>
              <div ref={parentRef} className="h-64 overflow-auto rounded-lg border">
                <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map((item) => (
                    <div key={item.key} className="absolute left-0 w-full" style={{ transform: `translateY(${item.start}px)` }}>
                      <PreviewLine row={preview[item.index]} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <fieldset className="grid gap-1 text-sm">
                  <legend className="font-semibold">Duplicados</legend>
                  <label><input type="radio" checked={duplicateMode === "omitir"} onChange={() => setDuplicateMode("omitir")} /> Omitir</label>
                  <label><input type="radio" checked={duplicateMode === "actualizar"} onChange={() => setDuplicateMode("actualizar")} /> Actualizar</label>
                  <label><input type="radio" checked={duplicateMode === "crear"} onChange={() => setDuplicateMode("crear")} /> Crear otro</label>
                </fieldset>
                <fieldset className="grid gap-1 text-sm">
                  <legend className="font-semibold">Si falta la condición de IVA</legend>
                  <label><input type="radio" checked={ivaMode === "regla"} onChange={() => setIvaMode("regla")} /> Completar por el CUIT</label>
                  <label><input type="radio" checked={ivaMode === "bloque"} onChange={() => setIvaMode("bloque")} /> Poner la misma a todas</label>
                  {ivaMode === "bloque" ? (
                    <select className="h-8 rounded-lg border px-2" value={ivaBloque} onChange={(event) => setIvaBloque(event.target.value)}>
                      <option value="ri">Responsable inscripto</option>
                      <option value="monotributo">Monotributo</option>
                      <option value="cf">Consumidor final</option>
                      <option value="exento">Exento</option>
                    </select>
                  ) : null}
                  <label><input type="radio" checked={ivaMode === "manual"} onChange={() => setIvaMode("manual")} /> No importar esas filas</label>
                </fieldset>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={Boolean(busy)} onClick={() => void confirmImport()}>Confirmar importación</Button>
                <Button variant="outline" disabled={!jobId || Boolean(busy)} onClick={() => void apiSend<{ summary: { created: number; updated: number; skipped: number; failed: number }; compare: { real: { clientes: string; ventas: string; compras: string }; sandbox: { clientes: string; ventas: string; compras: string } } }>("/api/migracion/ensayo", "POST", { jobId }).then((data) => {
                  const duplicates = preview.filter((row) => row.duplicate).length;
                  const text = `En el ensayo se crearon ${data.summary.created} (esta empresa marcaba ${duplicates} duplicados, que en el ensayo no existen). Actualizadas ${data.summary.updated}, con error ${data.summary.failed}. Clientes del ensayo ${data.compare.sandbox.clientes}. Ventas del ensayo ${formatMoney(Number(data.compare.sandbox.ventas))} contra ${formatMoney(Number(data.compare.real.ventas))}.`;
                  setEnsayo(text);
                  toast.success("Ensayo listo");
                }).catch((error) => toast.error(error instanceof ApiError ? error.message : "No se pudo ensayar"))}>Probar en empresa de ensayo</Button>
              </div>
              {ensayo ? <p className="text-sm">{ensayo}</p> : null}
            </div>
          ) : null}
          <ImportResult result={result} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Tu puesto puede exportar, pero no importar.</p>
      )}

      {me.data && can(me.data.permissions, "configuracion", "editar") ? <SaldosIniciales /> : null}
      <section>
        <h2 className="mb-2 text-xl">Importaciones recientes</h2>
        <ul className="divide-y rounded-xl border bg-card">
          {(jobs.data?.jobs ?? []).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                {job.filename} · {job.entity} · {job.status}
                {job.status === "importado" ? <ImportResult result={job.summary} /> : null}
              </span>
              {job.status === "importado" && current?.canImport && me.data && (me.data.role.key === "admin" || job.user_id === me.data.user.id) ? (
                <Button variant="outline" onClick={() => void undoJob(job.id)}>Deshacer</Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ImportResult({ result }: { result: Summary | null }) {
  if (!result || result.created == null && result.updated == null && result.skipped == null) return null;
  return (
    <div className="mt-2 grid gap-1 text-sm">
      <p>Creadas {result.created ?? 0}. Actualizadas {result.updated ?? 0}. Omitidas {result.skipped ?? 0}{result.failed ? `. Con error ${result.failed}` : ""}.</p>
      {(result.messages ?? []).map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
    </div>
  );
}

let lastSaldoToast: { message: string; at: number } | null = null;

function saldoToast(kind: "success" | "error", message: string) {
  const decision = acceptToast(message, Date.now(), lastSaldoToast);
  lastSaldoToast = decision.next;
  if (!decision.accept) return;
  if (kind === "success") toast.success(message);
  else toast.error(message);
}

function SaldosIniciales() {
  const [tipo, setTipo] = useState("cliente");
  const [codigo, setCodigo] = useState("");
  const [importe, setImporte] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const busy = useRef(false);
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 className="text-xl">Saldos iniciales</h2>
      <p className="text-sm text-muted-foreground">Clientes, proveedores, caja, banco y stock. El código es el de la ficha, el nombre de la caja o el SKU.</p>
      <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (busy.current) return;
        if (!codigo.trim()) { saldoToast("error", "Poné el código o el nombre"); return; }
        const money = tipo === "stock" || tipo === "tanque" ? null : parseMoneyToCents(importe);
        if ((tipo === "cliente" || tipo === "proveedor" || tipo === "caja" || tipo === "banco") && money == null) { saldoToast("error", "El importe tiene que ser un número"); return; }
        busy.current = true;
        void apiSend<{ applied: number }>("/api/migracion/saldos", "POST", {
          fecha,
          filas: [{ tipo, codigo, importeCents: money ?? undefined, cantidad: tipo === "stock" || tipo === "tanque" ? Number(importe.replace(",", ".")) : undefined }],
        }).then((data) => saldoToast("success", data.applied ? "Saldo inicial anotado" : "No encontré esa cuenta")).catch((error) => saldoToast("error", error instanceof ApiError ? error.message : "No se pudo")).finally(() => { busy.current = false; });
      }}>
        <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Tipo de saldo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
          <option value="cliente">Cliente</option>
          <option value="proveedor">Proveedor</option>
          <option value="caja">Caja</option>
          <option value="banco">Banco</option>
          <option value="stock">Stock</option>
          <option value="tanque">Tanque</option>
        </select>
        <Input aria-label="Código o nombre" placeholder="Código o nombre" value={codigo} onChange={(event) => setCodigo(event.target.value)} />
        <Input aria-label="Importe o cantidad" placeholder={tipo === "stock" || tipo === "tanque" ? "Cantidad" : "Importe"} value={importe} onChange={(event) => setImporte(event.target.value)} />
        <Input aria-label="Fecha" type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} />
        <Button type="submit" variant="outline">Anotar saldo</Button>
      </form>
    </section>
  );
}
