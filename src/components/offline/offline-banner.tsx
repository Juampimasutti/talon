"use client";

import { useEffect, useState } from "react";
import { bannerCopy } from "@/lib/offline/engine";
import { holdSyncUntilOnline, isReachable, isSyncing, markReachable, pendingCount, pingHealth, precacheShell, probeServer, releaseSyncHold, reviewItems, setOfflineScope, watchSync, flushQueue, cacheReference, discardReview } from "@/lib/offline/submit";
import { readDurableSession } from "@/lib/api/client";
import { useCachedMe, useMe } from "@/components/use-me";

function browserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

type Item = { key: string; kind: string; reason: string; payload?: Record<string, unknown> };

export function OfflineBanner() {
  const me = useMe();
  const cached = useCachedMe();
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<Item[]>([]);

  useEffect(() => {
    const userId = me.data?.user.id ?? cached?.user.id ?? null;
    const companyId = me.data?.company.id ?? cached?.company.id ?? null;
    setOfflineScope(userId, companyId);
    if (me.data) void precacheShell(me.data);
  }, [me.data, cached?.user.id, cached?.company.id]);

  useEffect(() => {
    let stop = false;
    let sawOffline = !browserOnline();
    function applyReach() {
      if (stop) return;
      if (!browserOnline()) {
        setOnline(false);
        return;
      }
      setOnline(isReachable());
    }
    async function counts() {
      if (stop) return;
      applyReach();
      setSyncing(isSyncing());
      setPending(await pendingCount());
      setConflicts(await reviewItems());
    }
    async function boot() {
      if (stop) return;
      if (!browserOnline()) {
        holdSyncUntilOnline();
        markReachable(false);
        setOnline(false);
        await counts();
        return;
      }
      const onlineNow = await probeServer();
      if (stop) return;
      setOnline(browserOnline() && onlineNow);
      if (onlineNow) await cacheReference().catch(() => undefined);
      await counts();
    }
    void boot();
    const onReach = () => {
      applyReach();
      setSyncing(isSyncing());
      void counts();
    };
    const onFetchOk = () => {
      if (!browserOnline()) return;
      setOnline(true);
      markReachable(true);
    };
    const onOffline = () => {
      sawOffline = true;
      holdSyncUntilOnline();
      markReachable(false);
      setOnline(false);
      void precacheShell(readDurableSession());
    };
    const onOnline = () => {
      if (!browserOnline()) {
        setOnline(false);
        return;
      }
      void probeServer().then(async (up) => {
        if (up && browserOnline()) {
          await cacheReference(true).catch(() => undefined);
          window.dispatchEvent(new Event("talon-fetch-ok"));
        }
        if (!stop) setOnline(browserOnline() && up);
        await counts();
      });
    };
    const markOffline = () => {
      sawOffline = true;
      holdSyncUntilOnline();
      markReachable(false);
      setOnline(false);
    };
    const syncLine = () => {
      if (!browserOnline()) markOffline();
    };
    syncLine();
    const probe = () => {
      if (!browserOnline()) {
        markOffline();
        return;
      }
      void pingHealth().then((up) => {
        if (stop) return;
        if (!up || !browserOnline()) {
          markOffline();
          return;
        }
        if (!sawOffline) return;
        sawOffline = false;
        releaseSyncHold();
        markReachable(true);
        setOnline(true);
        window.dispatchEvent(new Event("online"));
      });
    };
    const lineTimer = window.setInterval(() => {
      syncLine();
      probe();
    }, 4_000);
    probe();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("talon-outbox", onReach);
    window.addEventListener("talon-reach", onReach);
    window.addEventListener("talon-fetch-ok", onFetchOk);
    const stopWatch = watchSync(async () => {
      const count = await pendingCount();
      if (!count) return "idle";
      const mode = await flushQueue();
      if (!stop) await counts();
      return mode;
    });
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      (window as Window & { precacheShell?: () => Promise<void> }).precacheShell = precacheShell;
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      stop = true;
      window.clearInterval(lineTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("talon-outbox", onReach);
      window.removeEventListener("talon-reach", onReach);
      window.removeEventListener("talon-fetch-ok", onFetchOk);
      stopWatch();
    };
  }, []);

  async function discard(key: string) {
    await discardReview(key);
    setConflicts(await reviewItems());
    setPending(await pendingCount());
    setOnline(browserOnline() && isReachable());
    setSyncing(isSyncing());
  }

  function edit(item: Item) {
    sessionStorage.setItem("talon-retry-op", JSON.stringify(item));
    const href = item.kind.startsWith("reparto") ? "/reparto" : "/estacion";
    void discard(item.key).finally(() => window.location.assign(href));
  }

  const copy = bannerCopy({ online, syncing, pending, reviews: conflicts.length });
  if (!copy.visible) return null;
  return (
    <div className="border-b bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span>{copy.text}{pending ? " El comprobante provisorio se numera al sincronizar." : ""}</span>
        <span className="font-semibold">{pending} pendiente{pending === 1 ? "" : "s"}{conflicts.length ? ` · ${conflicts.length} para revisar` : ""}</span>
      </p>
      {conflicts.length ? (
        <ul className="mt-2 grid gap-2">
          {conflicts.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>{item.reason}</span>
              <span className="flex gap-2">
                <button type="button" className="underline" onClick={() => edit(item)}>Editar</button>
                <button type="button" className="underline" onClick={() => void discard(item.key)}>Descartar</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
