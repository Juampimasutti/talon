import { and, eq, inArray } from "drizzle-orm";
import { customFieldValues } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/tenant";

export async function saveCustomFields(
  tx: Tx,
  companyId: string,
  recordId: string,
  fields: { fieldId: string; value: string }[] | undefined,
) {
  if (!fields || fields.length === 0) return;
  const ids = fields.map((field) => field.fieldId);
  await tx
    .delete(customFieldValues)
    .where(and(eq(customFieldValues.companyId, companyId), eq(customFieldValues.recordId, recordId), inArray(customFieldValues.fieldId, ids)));
  const rows = fields.filter((field) => field.value.trim());
  if (rows.length === 0) return;
  await tx.insert(customFieldValues).values(
    rows.map((field) => ({
      companyId,
      fieldId: field.fieldId,
      recordId,
      value: field.value.trim(),
    })),
  );
}
