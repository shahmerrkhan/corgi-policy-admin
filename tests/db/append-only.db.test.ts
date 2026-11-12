import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { expectRejected, insertFixture, rolledBack } from "./helpers";

const APPEND_ONLY = [
  ["policy_events", "event"],
  ["ledger_entries", "charge"],
  ["payment_allocations", "allocation"],
  ["payment_status_events", "statusEvent"],
  ["coverage_lines", "coverageLine"],
] as const;

describe("append-only tables reject UPDATE, DELETE and TRUNCATE", () => {
  it.each(APPEND_ONLY)("%s", async (table, key) => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      const t = sql.identifier(table);
      const id = ids[key];

      await expectRejected(
        tx,
        sql`UPDATE ${t} SET created_at = created_at WHERE id = ${id}`,
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
