const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function inflightSize(): number {
  return inflight.size;
}
