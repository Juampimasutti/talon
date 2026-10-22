"use client";

import { useSyncExternalStore } from "react";

export const IMP_EMPRESA_STORAGE = "talon.impuestos.empresa";
export const IMP_EMPRESA_EVENT = "talon-impuestos-empresa";

export function empresaIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/impuestos\/empresas\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;
}

export function rememberEmpresa(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IMP_EMPRESA_STORAGE, id);
  window.dispatchEvent(new CustomEvent(IMP_EMPRESA_EVENT, { detail: id }));
}

export function rememberedEmpresa(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(IMP_EMPRESA_STORAGE);
}

export function useRememberedEmpresa(): string | null {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener(IMP_EMPRESA_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(IMP_EMPRESA_EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    rememberedEmpresa,
    () => null,
  );
}
