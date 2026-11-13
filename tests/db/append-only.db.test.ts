import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { expectRejected, insertFixture, rolledBack } from "./helpers";

// [table, fixture id key, a column to "update" to itself]
const APPEND_ONLY = [
  ["policy_events", "event", "created_at"],
  ["ledger_entries", "charge", "created_at"],
  ["payment_allocations", "allocation", "created_at"],
  ["payment_status_events", "statusEvent", "created_at"],
  ["coverage_lines", "coverageLine", "created_at"],
  ["stripe_events", "stripeEvent", "received_at"],
  ["email_log", "emailLog", "created_at"],
] as const;

describe("append-only tables reject UPDATE, DELETE and TRUNCATE", () => {
  it.each(APPEND_ONLY)("%s", async (table, key, column) => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      const t = sql.identifier(table);
      const id = ids[key];

      await expectRejected(
        tx,
        sql`UPDATE ${t} SET ${sql.identifier(column)} = ${sql.identifier(column)} WHERE id = ${id}`,
        new RegExp(`append-only: UPDATE on ${table} is not allowed`),
      );
      await expectRejected(
        tx,
        sql`DELETE FROM ${t} WHERE id = ${id}`,
        new RegExp(`append-only: DELETE on ${table} is not allowed`),
      );
      await expectRejected(
        tx,
        sql`TRUNCATE ${t} CASCADE`,
        new RegExp(`append-only: TRUNCATE on ${table} is not allowed`),
      );

      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM ${t} WHERE id = ${id}`);
      expect(rows.rows[0]).toEqual({ n: 1 });
    });
  });

  it("every append-only table has its triggers installed", async () => {
    await rolledBack(async (tx) => {
      const res = await tx.execute(sql`
        SELECT c.relname AS table, t.tgname AS trigger
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        ORDER BY 1, 2`);
      const names = res.rows.map((r) => `${r.table}.${r.trigger}`);
      for (const [table] of APPEND_ONLY) {
        expect(names).toContain(`${table}.${table}_no_update_delete`);
        expect(names).toContain(`${table}.${table}_no_truncate`);
      }
      for (const table of ["policies", "payments"]) {
        expect(names).toContain(`${table}.${table}_guard_update`);
        expect(names).toContain(`${table}.${table}_no_delete`);
        expect(names).toContain(`${table}.${table}_no_truncate`);
      }
    });
  });
});
