import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { getDb } from "./client";
import type * as coreSchema from "./schema";

export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof coreSchema,
  ExtractTablesWithRelations<typeof coreSchema>
>;

export async function withTenant<T>(
  companyId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  lock: "shared" | "exclusive" = "shared",
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      lock === "exclusive"
        ? sql`select pg_advisory_xact_lock(hashtextextended(${companyId},260026))`
        : sql`select pg_advisory_xact_lock_shared(hashtextextended(${companyId},260026))`,
    );
    await tx.execute(
      sql`select set_config('app.company_id', ${companyId}, true)`,
    );
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(
      sql`select set_config('statement_timeout', '12000', true)`,
    );
    return fn(tx);
  });
}
