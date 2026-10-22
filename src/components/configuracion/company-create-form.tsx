"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apiGet,
  apiSend,
  clearSessionCache,
  primeSession,
  type Me,
} from "@/lib/api/client";
import { ESTUDIO_FUTURE_MODULES, ESTUDIO_MODULES, SECTORS, type CompanyMode } from "@/lib/company-setup";
import { MODULES } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Sector = keyof typeof SECTORS;
const initial = {
  name: "",
  legalName: "",
  cuit: "",
  taxCondition: "ri",
  iibb: "",
  address: "",
  city: "",
  province: "",
  activityStartedOn: "",
};

export function CompanyCreateForm({ defaultMode = "negocio" }: { defaultMode?: CompanyMode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState(initial);
  const [sector, setSector] = useState<Sector>("comercio");
  const [modules, setModules] = useState<string[]>([
    ...SECTORS.comercio.modules,
  ]);
  const [tipo, setTipo] = useState<CompanyMode>(defaultMode);
  const [points, setPoints] = useState("1");
  const [basicLedger, setBasicLedger] = useState(false);
  return (
    <form
      className="grid max-w-2xl gap-3 rounded border bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        try {
          const pointsOfSale = points
            .split(",")
            .map((point) => Number(point.trim()));
          await apiSend("/api/empresas", "POST", {
            ...form,
            tipo,
            businessSector: sector,
            enabledModules: tipo === "estudio" ? [...ESTUDIO_MODULES] : modules,
            pointsOfSale,
            basicLedger,
          });
          clearSessionCache();
          const next = await apiGet<Me>("/api/auth/me", { fresh: true });
          queryClient.clear();
          primeSession(next);
          queryClient.setQueryData(["me"], next);
          toast.success(`Empresa «${next.company.name}» creada. Ahora estás trabajando en ella.`, { duration: 8000 });
          router.push(tipo === "estudio" ? "/impuestos" : "/tablero");
          router.refresh();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudo crear la empresa",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <h3 className="font-semibold">Nueva empresa</h3>
      <p className="text-sm text-muted-foreground">Al crearla, pasarás a trabajar en la nueva empresa. Podés volver a la anterior desde el selector del menú.</p>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 font-semibold">¿Negocio o Estudio contable?</legend>
        {(
          [
            ["negocio", "Negocio", "Ventas, stock, caja y el resto de los módulos según el rubro."],
            ["estudio", "Estudio contable", "Sólo Impuestos (Libro IVA, importación de ARCA). Vas a quedar como Contador."],
          ] as const
        ).map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2">
            <input type="radio" name="tipo" value={key} checked={tipo === key} onChange={() => setTipo(key)} />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="block text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1 text-sm" hidden={tipo === "estudio"}>
        Rubro
        <select
          className="h-8 rounded border px-2"
          value={sector}
          onChange={(event) => {
            const next = event.target.value as Sector;
            setSector(next);
            setModules([...SECTORS[next].modules]);
          }}
        >
          {Object.entries(SECTORS).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["name", "Nombre de fantasía"],
            ["legalName", "Razón social"],
            ["cuit", "CUIT"],
            ["iibb", "IIBB"],
            ["address", "Domicilio"],
            ["city", "Localidad"],
            ["province", "Provincia"],
            ["activityStartedOn", "Inicio de actividades"],
          ] as const
        ).map(([key, label]) => (
          <label className="grid gap-1 text-sm" key={key}>
            {label}
            <Input
              type={key === "activityStartedOn" ? "date" : "text"}
              value={form[key]}
              onChange={(event) =>
                setForm({ ...form, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        Condición de IVA
        <select
          className="h-8 rounded border px-2"
          value={form.taxCondition}
          onChange={(event) =>
            setForm({ ...form, taxCondition: event.target.value })
          }
        >
          <option value="ri">Responsable inscripto</option>
          <option value="monotributo">Monotributo</option>
          <option value="exento">Exento</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Puntos de venta (separados por coma)
        <Input
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          placeholder="1, 2"
        />
      </label>
      {tipo === "estudio" ? (
        <div className="grid gap-1 text-sm">
          <span className="font-semibold">Módulos del estudio</span>
          <span>✓ Impuestos</span>
          {ESTUDIO_FUTURE_MODULES.map((item) => (
            <span key={item.key} className="text-muted-foreground">○ {item.label}</span>
          ))}
        </div>
      ) : (
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Módulos activos</legend>
        {MODULES.filter(
          (item) => item.toggle && item.key !== "contabilidad",
        ).map((item) => (
          <label className="flex gap-2 text-sm" key={item.key}>
            <input
              type="checkbox"
              checked={modules.includes(item.key)}
              onChange={(event) =>
                setModules((current) =>
                  event.target.checked
                    ? [...current, item.key]
                    : current.filter((key) => key !== item.key),
                )
              }
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      )}
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={basicLedger}
          onChange={(event) => setBasicLedger(event.target.checked)}
        />
        Preparar plan de cuentas básico (sin asientos automáticos)
      </label>
      <p className="text-sm text-muted-foreground">
        {tipo === "estudio" ? "Vas a quedar como Contador." : "Vas a quedar como administrador."} Después podés sumar otro usuario desde
        la pestaña Usuarios. Los comprobantes empiezan sin facturación
        electrónica.
      </p>
      <Button disabled={pending} type="submit">
        {pending ? "Creando…" : "Crear y abrir empresa"}
      </Button>
    </form>
  );
}

export function NewCompanyScreen() {
  const capabilities = useQuery({
    queryKey: ["company-capabilities-standalone"],
    queryFn: () => apiGet<{ canCreate: boolean; defaultMode?: CompanyMode }>("/api/empresas/capacidades"),
    retry: false,
  });
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-5">
      <h1 className="text-2xl font-semibold">Alta de empresa</h1>
      {capabilities.isPending ? (
        <p>Cargando…</p>
      ) : capabilities.data?.canCreate ? (
        <CompanyCreateForm defaultMode={capabilities.data.defaultMode} />
      ) : (
        <p role="alert">
          {capabilities.error?.message ??
            "Se requiere autorización de estudio o superadmin."}
        </p>
      )}
      <a className="text-primary underline" href="/respaldos">
        Mis respaldos
      </a>
      <a className="text-primary underline" href="/ingreso">
        Volver al ingreso
      </a>
    </main>
  );
}
