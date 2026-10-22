import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as coreSchema from "./schema";
import * as taxSchema from "./schema-impuestos";

export const schema = { ...coreSchema, ...taxSchema };

export type Database = PostgresJsDatabase<typeof schema>;

let database: Database | null = null;
let shutdown: (() => Promise<void>) | null = null;

export function getDb(): Database {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Falta DATABASE_URL. Copiá .env.example a .env.local.");
  }
  const queryClient = postgres(url, {
    max: 10,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  database = drizzle(queryClient, { schema });
  shutdown = () => queryClient.end({ timeout: 5 });
  return database;
}

export async function closeDb(): Promise<void> {
  if (shutdown) await shutdown();
  database = null;
  shutdown = null;
}
