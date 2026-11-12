// Reads over Neon HTTP (no transactions, no pooled connections). Commands use withTx().
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { databaseUrl } from "./env";
import * as schema from "./schema";

export type ReadDb = NeonHttpDatabase<typeof schema>;

let db: ReadDb | undefined;

/** Lazy so importing this module never needs DATABASE_URL (e.g. during `next build`). */
export function getDb(): ReadDb {
  db ??= drizzle({ client: neon(databaseUrl()), schema });
  return db;
}
