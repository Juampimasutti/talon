import { formatQty } from "@/lib/format";

export const OP_KINDS = [
  "turno",
  "aforadores",
  "shop",
  "cobro",
  "vale",
  "reparto.carga",
  "reparto.entrega",
  "reparto.retorno",
  "comprobante",
] as const;

export type OpKind = (typeof OP_KINDS)[number];

export type QueuedOp = {
  key: string;
  kind: OpKind;
  payload: Record<string, unknown>;
  createdAt: string;
  /** userId:companyId. Sin dueño, el ítem queda oculto y no se sincroniza. */
  owner?: string;
  /** Generación del servidor al preparar la operación; no se cambia al sincronizar. */
  recoveryVersion?: string | null;
};

export type SyncStep = {
  key: string;
  status: "applied" | "duplicate" | "conflict";
  reason?: string;
  serverQuantity?: number;
};

export function sortQueue(ops: QueuedOp[]): QueuedOp[] {
  return [...ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
}

export function scopeKey(userId: string, companyId: string): string {
  return `${userId}:${companyId}`;
}

/** Solo los ítems de esta sesión. Los viejos, sin dueño, no se muestran ni se envían. */
export function opsForScope<T extends { owner?: string }>(rows: T[], scope: string | null): T[] {
  if (!scope) return [];
  return rows.filter((row) => row.owner === scope);
}

export function bannerCopy(state: { online: boolean; syncing: boolean; pending: number; reviews: number }): { visible: boolean; text: string } {
  if (state.online && !state.syncing && state.pending === 0 && state.reviews === 0) return { visible: false, text: "" };
  if (!state.online) {
    return { visible: true, text: "Sin conexión. Lo que cargues en la playa, el shop, los vales y el reparto queda en este dispositivo." };
  }
  if (state.syncing || state.pending > 0) return { visible: true, text: "En línea. Sincronizando lo pendiente." };
  return { visible: true, text: "En línea." };
}

export function normalizePlate(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

export function valeClientError(customerId: string): string | null {
  if (!customerId.trim()) return "Elegí un cliente de flota";
  return null;
}

export function valeFormError(input: { customerId: string; vehicleId: string; plate: string; liters: number | null }): string | null {
  const client = valeClientError(input.customerId);
  if (client) return client;
  if (!input.vehicleId && !input.plate.trim()) return "Elegí la patente";
  if (input.liters == null || !(input.liters > 0)) return "La cantidad del vale tiene que ser mayor a cero";
  return null;
}

export function resolveFleetVehicle<T extends { id: string; customer_id?: string; plate: string }>(
  vehicles: T[],
  customerId: string,
  vehicleId: string,
  typedPlate: string,
): T | undefined {
  const mine = vehicles.filter((item) => item.customer_id === customerId);
  const pool = mine.length ? mine : vehicles;
  const byId = pool.find((item) => item.id === vehicleId);
  if (byId) return byId;
  const needle = normalizePlate(typedPlate);
  if (!needle) return undefined;
  return pool.find((item) => normalizePlate(item.plate) === needle);
}

export function mergeFleetVoucher<T extends { id: string; customer_id: string; product: string; liters: string; plate: string | null }>(vouchers: T[], pending: T): T[] {
  if (vouchers.some((item) => item.id === pending.id)) return vouchers;
  return [pending, ...vouchers];
}

/** El servidor manda. La fila local sigue solo si el vale sigue en la cola de este usuario. */
export function reconcileFleetVouchers<T extends { id: string; customer_id: string; product: string; liters: string; plate: string | null }>(
  server: T[],
  previous: T[],
  liveLocalIds: ReadonlySet<string>,
): T[] {
  const confirmed = server.filter((item) => !item.id.startsWith("local-"));
  const locals = previous.filter((item) => item.id.startsWith("local-") && liveLocalIds.has(item.id));
  return locals.reduce((list, local) => mergeFleetVoucher(list, local), confirmed);
}

/** Rebuild pending rows from durable, tenant-scoped operations after a reload. */
export function queuedFleetVouchers(ops: QueuedOp[], scope: string | null, products: { id: string; name: string; unit: string }[]) {
  return opsForScope(ops, scope).filter((op) => op.kind === "vale").map((op) => {
    const product = products.find((item) => item.id === op.payload.productId);
    const lines = op.payload.lines as { description?: string }[] | undefined;
    return {
      id: `local-${op.key}`,
      customer_id: String(op.payload.customerId ?? ""),
      product: product?.name ?? lines?.[0]?.description ?? "Combustible",
      unit: product?.unit ?? "litro",
      liters: String(op.payload.liters ?? 0),
      amount_cents: String(op.payload.clientTotalCents ?? 0),
      plate: op.payload.plate ? String(op.payload.plate) : null,
      status: "pendiente",
    };
  });
}

export function stockDecision(requested: number, available: number): { apply: true; remaining: number } | { apply: false; remaining: number; reason: string } {
  if (requested <= available + 0.0005) return { apply: true, remaining: Math.round((available - requested) * 1000) / 1000 };
  return {
    apply: false,
    remaining: available,
    reason: `No alcanza el stock: hay ${formatQty(available)} y se pidieron ${formatQty(requested)}. Quedó el stock del servidor.`,
  };
}

export function priceDiscrepancy(clientCents: number | null | undefined, serverCents: number) {
  if (clientCents == null || clientCents === serverCents) return null;
  return { clientCents, serverCents, review: true as const };
}

export function reuseKey(kind: string, payload: unknown, now: number, windowMs: number, previous: { fingerprint: string; key: string; at: number } | null) {
  const fingerprint = `${kind}:${JSON.stringify(payload)}`;
  if (previous && previous.fingerprint === fingerprint && now - previous.at < windowMs) return { fingerprint, key: previous.key, at: previous.at };
  return null;
}

const STOCK_KINDS = new Set<OpKind>(["shop", "reparto.entrega", "reparto.carga", "reparto.retorno"]);

function stockId(op: QueuedOp): string {
  if (op.kind === "shop") return String(op.payload.productId ?? "");
  return String(op.payload.compartmentId ?? "");
}

function stockQty(op: QueuedOp): number {
  return Number(op.payload.quantity ?? op.payload.liters ?? 0);
}

/** Reproduce el orden de sincronización: la clave repetida no se aplica de nuevo y el stock del servidor no baja de cero. */
export function replay(ops: QueuedOp[], seen: Set<string>, stock: Map<string, number>): SyncStep[] {
  const steps: SyncStep[] = [];
  for (const op of sortQueue(ops)) {
    if (seen.has(op.key)) {
      steps.push({ key: op.key, status: "duplicate" });
      continue;
    }
    seen.add(op.key);
    if (STOCK_KINDS.has(op.kind)) {
      const id = stockId(op);
      const decision = stockDecision(stockQty(op), stock.get(id) ?? 0);
      if (!decision.apply) {
        steps.push({ key: op.key, status: "conflict", reason: decision.reason, serverQuantity: decision.remaining });
        continue;
      }
      stock.set(id, decision.remaining);
    }
    steps.push({ key: op.key, status: "applied" });
  }
  return steps;
}

export type ProvisionalReceipt = {
  localNumber: string;
  partyName: string;
  issuedOn: string;
  lines: { description: string; quantity: number; totalCents: number }[];
  totalCents: number;
  fiscal: "provisorio";
  cae: null;
  printableTitle: string;
};

export function provisionalReceipt(input: { localNumber: string; partyName: string; issuedOn: string; lines: ProvisionalReceipt["lines"]; totalCents: number }): ProvisionalReceipt {
  return {
    ...input,
    fiscal: "provisorio",
    cae: null,
    printableTitle: "Comprobante provisorio",
  };
}

export async function authorizeIfLive(mode: "off" | "live", electronic: boolean, port: { authorize: () => Promise<{ cae: string }> }) {
  if (mode === "live" && electronic) {
    const authorization = await port.authorize();
    return { status: "autorizado" as const, cae: authorization.cae };
  }
  return { status: "no_electronico" as const, cae: null };
}
