"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, loadSession, readDurableSession, type Me } from "@/lib/api/client";

export function useCachedMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const apply = () => setMe(readDurableSession());
    apply();
    window.addEventListener("talon-session", apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener("talon-session", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);
  return me;
}

export type Catalog = {
  pointsOfSale?: number[];
  priceLists: { id: string; name: string; isDefault: boolean }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  documentTypes: {
    id: string;
    code: string;
    name: string;
    kind: string;
    sign: number;
    movesStock: boolean;
    movesAccount: boolean;
    movesCash: boolean;
    movesVat: boolean;
    electronic: boolean;
    nextNumber: number;
    active: boolean;
  }[];
  cashAccounts: { id: string; name: string; kind: string }[];
  categories: { id: string; kind: string; name: string }[];
  customFields: { id: string; entity: string; label: string; fieldType: string; required: boolean }[];
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => loadSession(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    networkMode: "offlineFirst",
  });
}

export function useCatalog(companyId?: string) {
  return useQuery({
    queryKey: ["catalogos", companyId],
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    queryFn: () => apiGet<Catalog>("/api/catalogos"),
  });
}
