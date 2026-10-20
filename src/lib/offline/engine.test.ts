import { describe, expect, it, vi } from "vitest";
import { authorizeIfLive, bannerCopy, queuedFleetVouchers, mergeFleetVoucher, opsForScope, priceDiscrepancy, provisionalReceipt, reconcileFleetVouchers, replay, resolveFleetVehicle, reuseKey, scopeKey, sortQueue, stockDecision, valeClientError, valeFormError, type QueuedOp } from "./engine";
import { batchRejected, nextSyncDelay, partitionSyncResults, queryKeysAfterSync, retryDelay, SYNC_BACKOFF_CAP_MS, SYNC_POLL_MS } from "./submit";

const op = (partial: Partial<QueuedOp> & Pick<QueuedOp, "key" | "kind" | "createdAt">): QueuedOp => ({
  payload: {},
  ...partial,
});

describe("sincronización offline", () => {
  it("ordena por hora y no vuelve a aplicar la misma clave", () => {
    const queued = [
      op({ key: "b", kind: "aforadores", createdAt: "2026-10-20T12:00:00.000Z" }),
      op({ key: "a", kind: "turno", createdAt: "2026-10-20T11:00:00.000Z" }),
    ];
    expect(sortQueue(queued).map((item) => item.key)).toEqual(["a", "b"]);
    const seen = new Set<string>();
    const first = replay(queued, seen, new Map());
    const second = replay(queued, seen, new Map());
    expect(first.map((item) => item.status)).toEqual(["applied", "applied"]);
    expect(second.every((item) => item.status === "duplicate")).toBe(true);
  });

  it("un doble envío dentro de la ventana reutiliza la clave", () => {
    const first = reuseKey("vale", { liters: 20 }, 1_000, 10_000, null);
    expect(first).toBeNull();
    const again = reuseKey("vale", { liters: 20 }, 2_000, 10_000, { fingerprint: "vale:{\"liters\":20}", key: "misma", at: 1_000 });
    expect(again?.key).toBe("misma");
    const later = reuseKey("vale", { liters: 20 }, 20_000, 10_000, { fingerprint: "vale:{\"liters\":20}", key: "misma", at: 1_000 });
    expect(later).toBeNull();
  });

  it("si no alcanza, gana el stock del servidor y queda para revisar", () => {
    const stock = new Map([["aceite", 2]]);
    const steps = replay(
      [
        op({ key: "1", kind: "shop", createdAt: "2026-10-20T10:00:00.000Z", payload: { productId: "aceite", quantity: 5 } }),
        op({ key: "2", kind: "shop", createdAt: "2026-10-20T10:01:00.000Z", payload: { productId: "aceite", quantity: 1 } }),
      ],
      new Set(),
      stock,
    );
    expect(steps[0]).toMatchObject({ status: "conflict", serverQuantity: 2 });
    expect(steps[1].status).toBe("applied");
    expect(stock.get("aceite")).toBe(1);
    const denied = stockDecision(5, 2);
    expect(denied.apply).toBe(false);
    if (!denied.apply) expect(denied.reason).toMatch(/hay 2/);
  });

  it("el provisorio no tiene CAE y ARCA solo se llama al emitir en vivo", async () => {
    const receipt = provisionalReceipt({
      localNumber: "PROV-0001",
      partyName: "Transportes del Litoral SA",
      issuedOn: "2026-10-19",
      lines: [{ description: "Nafta súper", quantity: 40, totalCents: 4_800_000 }],
      totalCents: 4_800_000,
    });
    expect(receipt.cae).toBeNull();
    expect(receipt.fiscal).toBe("provisorio");
    const port = { authorize: vi.fn(async () => ({ cae: "123" })) };
    expect(await authorizeIfLive("off", true, port)).toEqual({ status: "no_electronico", cae: null });
    expect(port.authorize).not.toHaveBeenCalled();
    expect(await authorizeIfLive("live", true, port)).toEqual({ status: "autorizado", cae: "123" });
    expect(priceDiscrepancy(100, 120)).toEqual({ clientCents: 100, serverCents: 120, review: true });
    expect(priceDiscrepancy(120, 120)).toBeNull();
  });

  it("un vale sincronizado refresca la flota y uno en cola no", () => {
    expect(queryKeysAfterSync([{ status: "applied", kind: "vale" }])).toEqual(["estacion-flota"]);
    expect(queryKeysAfterSync([{ status: "duplicate", kind: "vale" }])).toEqual(["estacion-flota"]);
    expect(queryKeysAfterSync([{ status: "conflict", kind: "vale" }])).toEqual([]);
    expect(queryKeysAfterSync([{ status: "applied", kind: "reparto.entrega" }])).toEqual(["reparto"]);
    expect(queryKeysAfterSync([])).toEqual([]);
  });

  it("un rechazo del servidor no se reintenta y la espera tiene tope", () => {
    const parts = partitionSyncResults([
      { status: "applied", key: "ok" },
      { status: "error", key: "malo", message: "No encontramos el cliente" },
      { status: "duplicate", key: "ya" },
    ]);
    expect(parts.failed.map((item) => item.key)).toEqual(["malo"]);
    expect(parts.done.map((item) => item.status)).toEqual(["applied", "duplicate"]);
    expect(batchRejected(400)).toBe(true);
    expect(batchRejected(404)).toBe(true);
    expect(batchRejected(409)).toBe(true);
    expect(batchRejected(401)).toBe(false);
    expect(batchRejected(429)).toBe(false);
    expect(batchRejected(500)).toBe(false);
    expect(nextSyncDelay(0, "ok")).toBe(SYNC_POLL_MS);
    expect(nextSyncDelay(0, "idle")).toBe(SYNC_POLL_MS);
    expect(nextSyncDelay(3, "retry")).toBe(retryDelay(3));
    expect(nextSyncDelay(40, "retry")).toBe(SYNC_BACKOFF_CAP_MS);
  });

  it("la cola offline es de cada usuario y el aviso sigue a la red", () => {
    const scope = scopeKey("luciana", "estacion");
    const rows = [
      { key: "propio", owner: scope },
      { key: "ajeno", owner: scopeKey("oscar", "estacion") },
      { key: "viejo" },
    ];
    expect(opsForScope(rows, scope).map((row) => row.key)).toEqual(["propio"]);
    expect(opsForScope(rows, null)).toEqual([]);
    expect(opsForScope(rows, scopeKey("laura", "estacion"))).toEqual([]);
    expect(bannerCopy({ online: false, syncing: false, pending: 0, reviews: 0 }).visible).toBe(true);
    expect(bannerCopy({ online: false, syncing: false, pending: 0, reviews: 0 }).text).toMatch(/Sin conexión/);
    expect(bannerCopy({ online: false, syncing: false, pending: 1, reviews: 0 }).text).toMatch(/Sin conexión/);
    expect(bannerCopy({ online: true, syncing: true, pending: 1, reviews: 0 }).text).toBe("En línea. Sincronizando lo pendiente.");
    expect(bannerCopy({ online: true, syncing: false, pending: 0, reviews: 0 }).visible).toBe(false);
    expect(bannerCopy({ online: true, syncing: false, pending: 0, reviews: 1 }).text).toBe("En línea.");
    const saved = [{ id: "srv", customer_id: "c", product: "Nafta", liters: "20", plate: "AE123BC" }];
    const local = { id: "local-1", customer_id: "c", product: "Nafta", liters: "20", plate: "AE123BC" };
    // Two independent vouchers may have identical values; only their IDs deduplicate.
    expect(mergeFleetVoucher(saved, local)).toEqual([local, ...saved]);
    expect(mergeFleetVoucher([local, ...saved], local)).toEqual([local, ...saved]);
    expect(mergeFleetVoucher([], local)).toEqual([local]);
    const vehicles = [
      { id: "v1", customer_id: "c1", plate: "AE123BC" },
      { id: "v2", customer_id: "c2", plate: "AE200BB" },
    ];
    expect(resolveFleetVehicle(vehicles, "c1", "", "ae 123 bc")?.id).toBe("v1");
    expect(resolveFleetVehicle(vehicles, "c1", "v1", "")?.plate).toBe("AE123BC");
    expect(valeClientError("")).toBe("Elegí un cliente de flota");
    expect(valeClientError("c1")).toBeNull();
    expect(valeFormError({ customerId: "c1", vehicleId: "", plate: "", liters: 2 })).toBe("Elegí la patente");
    expect(valeFormError({ customerId: "c1", vehicleId: "v1", plate: "", liters: 2 })).toBeNull();
    const server = [{ id: "srv", customer_id: "c1", product: "Nafta súper", liters: "2", plate: null as string | null }];
    const ghost = { id: "local-rechazado", customer_id: "c1", product: "Nafta súper", liters: "2", plate: null as string | null };
    const queued = { id: "local-vivo", customer_id: "c1", product: "Gasoil", liters: "5", plate: "AE123BC" };
    expect(reconcileFleetVouchers(server, [ghost, queued], new Set(["local-vivo"]))).toEqual([queued, ...server]);
    expect(reconcileFleetVouchers(server, [ghost], new Set())).toEqual(server);
  });

  it("recupera vales después de F5 desde la cola propia sin mezclarlos con otro usuario", () => {
    const own = scopeKey("laura", "estacion");
    const payload = { customerId: "c1", productId: "diesel", liters: 3, clientTotalCents: 360000, plate: "AE123BC", lines: [{ description: "Gasoil" }] };
    const ops = [
      op({ key: "1", kind: "vale", createdAt: "2026-10-20", owner: own, payload }),
      op({ key: "2", kind: "vale", createdAt: "2026-10-20", owner: own, payload }),
      op({ key: "other", kind: "vale", createdAt: "2026-10-20", owner: scopeKey("otro", "estacion"), payload }),
      op({ key: "legacy", kind: "vale", createdAt: "2026-10-20", payload }),
      op({ key: "shop", kind: "shop", createdAt: "2026-10-20", owner: own, payload }),
    ];
    const restored = queuedFleetVouchers(ops, own, []);
    expect(restored.map((v) => v.id)).toEqual(["local-1", "local-2"]);
    expect(restored[0]).toMatchObject({ product: "Gasoil", liters: "3", amount_cents: "360000", status: "pendiente" });
    const server = [{ ...restored[0], id: "server", status: "abierto" }];
    const live = new Set(restored.map((v) => v.id));
    expect(reconcileFleetVouchers(server, restored, live)).toHaveLength(3);
    expect(reconcileFleetVouchers(server, restored, new Set())).toEqual(server);
    expect(queuedFleetVouchers(ops, null, [])).toEqual([]);
  });

  it("el reintento de sincronización no se rinde", () => {
    expect(retryDelay(0)).toBe(800);
    expect(retryDelay(2)).toBe(3200);
    expect(retryDelay(20)).toBe(SYNC_BACKOFF_CAP_MS);
    expect(retryDelay(40)).toBe(SYNC_BACKOFF_CAP_MS);
  });
});
