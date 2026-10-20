import { auditLog } from "../db/schema";
import type { Tx } from "../db/tenant";

export async function writeAudit(
  tx: Tx,
  entry: {
    companyId: string;
    userId: string;
    action: string;
    entity: string;
    entityId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    companyId: entry.companyId,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    metadata: entry.metadata ?? {},
  });
}
