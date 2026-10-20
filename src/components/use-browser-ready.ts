"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Mount storage-backed forms only after hydration, without reading storage on the server. */
export function useBrowserReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

export function readRetryPayload(prefix: string): Record<string, unknown> | null {
  const raw = sessionStorage.getItem("talon-retry-op");
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as { kind?: string; payload?: Record<string, unknown> };
    return item.kind?.startsWith(prefix) ? item.payload ?? {} : null;
  } catch {
    return null;
  }
}
