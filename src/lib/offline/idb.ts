import type { QueuedOp } from "./engine";

const DB = "talon-offline";
const VERSION = 1;

export type LocalConflict = { key: string; kind: string; reason: string; at: string; payload?: Record<string, unknown>; owner?: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "key" });
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "key" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putOp(op: QueuedOp) {
  const db = await open();
  const tx = db.transaction("outbox", "readwrite");
  tx.objectStore("outbox").put(op);
  await txDone(tx);
  db.close();
}

export async function listOps(): Promise<QueuedOp[]> {
  const db = await open();
  const tx = db.transaction("outbox", "readonly");
  const request = tx.objectStore("outbox").getAll();
  const rows = await new Promise<QueuedOp[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as QueuedOp[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

export async function deleteOp(key: string) {
  const db = await open();
  const tx = db.transaction("outbox", "readwrite");
  tx.objectStore("outbox").delete(key);
  await txDone(tx);
  db.close();
}

export async function putConflict(row: LocalConflict) {
  const db = await open();
  const tx = db.transaction("conflicts", "readwrite");
  tx.objectStore("conflicts").put(row);
  await txDone(tx);
  db.close();
}

export async function deleteConflict(key: string) {
  const db = await open();
  const tx = db.transaction("conflicts", "readwrite");
  tx.objectStore("conflicts").delete(key);
  await txDone(tx);
  db.close();
}

export async function listConflicts(): Promise<LocalConflict[]> {
  const db = await open();
  const tx = db.transaction("conflicts", "readonly");
  const request = tx.objectStore("conflicts").getAll();
  const rows = await new Promise<LocalConflict[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as LocalConflict[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

export async function putKv(key: string, value: unknown) {
  const db = await open();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, key);
  await txDone(tx);
  db.close();
}

export async function getKv<T>(key: string): Promise<T | null> {
  const db = await open();
  const tx = db.transaction("kv", "readonly");
  const request = tx.objectStore("kv").get(key);
  const value = await new Promise<T | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as T) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}
