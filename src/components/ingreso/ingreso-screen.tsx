"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { clearSessionCache, ApiError, apiSend, primeSession, type Me } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO = [
  ["Administración", "laura@talon.demo"],
  ["Mostrador", "mateo@talon.demo"],
  ["Caja", "sofia@talon.demo"],
  ["Depósito", "julian@talon.demo"],
  ["Compras", "carla@talon.demo"],
  ["Contador", "hector@talon.demo"],
  ["Estudio (monotributo)", "marina@talon.demo"],
] as const;

export function IngresoScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  function fill(mail: string, pass: string) {
    const form = formRef.current;
    if (!form) return;
    const email = form.elements.namedItem("email") as HTMLInputElement | null;
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    if (email) email.value = mail;
    if (password) password.value = pass;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const emailInput = event.currentTarget.elements.namedItem("email") as HTMLInputElement | null;
    const passwordInput = event.currentTarget.elements.namedItem("password") as HTMLInputElement | null;
    const email = String(data.get("email") ?? emailInput?.value ?? "").trim();
    const password = String(data.get("password") ?? passwordInput?.value ?? "");
    if (!email || !password) { toast.error("Completá el mail y la clave"); return; }
    setPending(true);
    try {
      const me = await apiSend<Me | { backupOnly: true } | { companySetupOnly: true }>("/api/auth/login", "POST", { email, password });
      queryClient.clear();
      if ("companySetupOnly" in me) { clearSessionCache(); router.push("/alta-empresa"); return; }
      if ("backupOnly" in me) { clearSessionCache(); router.push("/respaldos"); return; }
      primeSession(me);
      queryClient.setQueryData(["me"], me);
      router.push(me.company.tipo === "estudio" ? (me.permissions.includes("impuestos.ver") ? "/impuestos" : "/configuracion") : "/tablero");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No pude entrar");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center border-t-4 border-primary px-4 py-8 sm:px-10">
      <div className="mx-auto w-full max-w-md rounded-lg border bg-card p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">Paraná · Entre Ríos</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-primary">Talón</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          El mostrador, el depósito y la caja, en un solo lugar. Sirve para una distribuidora, un comercio o un estudio.
        </p>
        <form ref={formRef} noValidate onSubmit={submit} className="mt-8 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Mail</Label>
            <Input id="email" name="email" type="email" autoComplete="username" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Clave</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </div>
          <Button type="submit" disabled={pending} className="h-10">
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
        <div className="mt-8">
          <p className="text-sm font-semibold">Probar un puesto</p>
          <p className="text-sm text-muted-foreground">La clave de todos es talon1234.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO.map(([label, mail]) => (
              <button
                key={mail}
                type="button"
                className="min-h-8 rounded-lg border bg-card px-3 py-1 text-xs hover:bg-accent"
                onClick={() => fill(mail, "talon1234")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
