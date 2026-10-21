"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api/client";
import type { TaxCondition } from "@/lib/fiscal/letter";
import { TAX_CONDITION_LABELS } from "@/lib/fiscal/labels";
import { isValidCuit } from "@/lib/fiscal/cuit";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type CreatedParty = {
  id: string;
  name: string;
  cuit: string | null;
  taxCondition: TaxCondition;
  priceListId?: string | null;
  iibbPerceptionBps?: number | null;
};
export function PartyCreateDialog({
  kind,
  initialName,
  priceListId,
  onCreated,
  onClose,
}: {
  kind: "clientes" | "proveedores";
  initialName: string;
  priceListId?: string;
  onCreated: (party: CreatedParty) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [docType, setDocType] = useState("CUIT");
  const [cuit, setCuit] = useState("");
  const [taxCondition, setTaxCondition] = useState<TaxCondition>("ri");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const taxRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            Nuevo {kind === "clientes" ? "cliente" : "proveedor"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Al guardar queda seleccionado en el comprobante. Los renglones
          cargados se conservan.
        </p>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current) return;
            if (!name.trim()) {
              setError("Completá el nombre");
              nameRef.current?.focus();
              return;
            }
            if (docType === "CUIT" && cuit.trim() && !isValidCuit(cuit)) {
              setError("Revisá el CUIT, incluido su dígito verificador");
              taxRef.current?.focus();
              return;
            }
            lock.current = true;
            setPending(true);
            setError("");
            try {
              const created = await apiSend<CreatedParty>(
                `/api/${kind}`,
                "POST",
                {
                  name,
                  docType,
                  cuit,
                  taxCondition,
                  phone,
                  email,
                  ...(kind === "clientes"
                    ? { priceListId: priceListId || null }
                    : {}),
                },
              );
              await queryClient.invalidateQueries({ queryKey: [kind] });
              onCreated(created);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "No se pudo guardar la ficha",
              );
            } finally {
              lock.current = false;
              setPending(false);
            }
          }}
        >
          <label className="grid gap-1">
            Nombre
            <Input
              ref={nameRef}
              autoFocus
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              Documento
              <select
                className="h-9 rounded border px-2"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                <option>CUIT</option>
                <option>DNI</option>
                <option value="OTRO">Otro</option>
              </select>
            </label>
            <label className="grid gap-1">
              Número
              <Input
                ref={taxRef}
                value={cuit}
                maxLength={20}
                onChange={(e) => setCuit(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1">
            Condición frente al IVA
            <select
              className="h-9 rounded border px-2"
              value={taxCondition}
              onChange={(e) => setTaxCondition(e.target.value as TaxCondition)}
            >
              {TAX_CONDITION_LABELS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Teléfono
            <Input
              value={phone}
              maxLength={40}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            Correo
            <Input
              type="email"
              value={email}
              maxLength={120}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar y seleccionar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
