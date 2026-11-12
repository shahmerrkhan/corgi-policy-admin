// The only place a Pool is created. Each call opens a WebSocket Pool, runs `fn` in one
// transaction (commit on return, rollback on throw) and always ends the Pool.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { databaseUrl } from "./env";
import * as schema from "./schema";

function makeDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}

export type Tx = Parameters<Parameters<ReturnType<typeof makeDb>["transaction"]>[0]>[0];

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  try {
    return await makeDb(pool).transaction(fn);
  } finally {
    await pool.end();
  }
}
