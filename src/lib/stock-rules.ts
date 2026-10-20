export function isBelowMinimum(quantity: number, minimum: number): boolean {
  return minimum > 0 && quantity < minimum;
}

export function cashDirectionForParty(partyType: "customer" | "supplier"): "in" | "out" {
  return partyType === "customer" ? "in" : "out";
}

/** Una nota de crédito suma stock: no se le pide «emitir igual». */
export function blocksNegativeStock(delta: number, companyBlocks: boolean, override: boolean): boolean {
  if (delta >= 0) return false;
  return companyBlocks && !override;
}

/** El bloqueo de stock negativo se levanta solo si la persona confirma y puede editar stock. */
export function negativeStockDecision(companyBlocks: boolean, override: boolean, canOverride: boolean): { block: boolean; error: string | null } {
  if (!companyBlocks || !override) return { block: companyBlocks, error: null };
  if (!canOverride) return { block: true, error: "Tu puesto no puede dejar el stock en negativo." };
  return { block: false, error: null };
}

/** Pedido sigue la cadena. El resto usa el estado del comprobante, igual que la lista. */
export function documentStatusLabel(doc: { kind: string; status: string }, flow: "pendiente" | "remitido" | "facturado"): string {
  if (doc.status === "anulado") return "Anulado";
  if (doc.kind === "pedido") {
    if (flow === "facturado") return "Facturado";
    if (flow === "remitido") return "Remitido";
    return "Pendiente";
  }
  if (doc.status === "confirmado") return "Confirmado";
  return "Pendiente";
}

export function documentFlow(childKinds: readonly string[]): "pendiente" | "remitido" | "facturado" {
  if (childKinds.includes("venta")) return "facturado";
  if (childKinds.includes("remito")) return "remitido";
  return "pendiente";
}

/** El pedido con remito se factura desde el remito. Una venta ya emitida no se repite. */
export function invoiceBlocked(sourceKind: string, childKinds: readonly string[]): string | null {
  if (sourceKind === "pedido" && childKinds.includes("remito")) return "Ese pedido ya tiene remito. Facturá el remito para no cobrar dos veces.";
  if (childKinds.includes("venta")) return "Ese comprobante ya está facturado.";
  return null;
}

export function creditExceeds(invoiceCents: number, creditedCents: number, nextCents: number): boolean {
  return creditedCents + nextCents > invoiceCents + 1;
}

/** El exceso se avisa antes de preguntar si el contado se devuelve o queda a cuenta. */
export function creditNoteGate(exceeds: boolean, cashSale: boolean, refundChosen: boolean): "exceso" | "preguntar" | "emitir" {
  if (exceeds) return "exceso";
  if (cashSale && !refundChosen) return "preguntar";
  return "emitir";
}

export function derivedStockFactor(sourceKind: "pedido" | "remito", targetKind: "remito" | "venta", typeFactor: number): number {
  if (sourceKind === "remito" && targetKind === "venta") return 0;
  return typeFactor;
}

/** Pedido no mueve stock. El remito descuenta. La factura de ese remito no vuelve a descontar. */
export function chainStockDelta(pedidoFactor: number, remitoFactor: number, facturaFactor: number): number {
  return pedidoFactor + derivedStockFactor("pedido", "remito", remitoFactor) + derivedStockFactor("remito", "venta", facturaFactor);
}
