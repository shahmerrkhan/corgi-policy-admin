// email_log constraints against the real database (rolled back): one row per (kind, event_id),
// so a webhook retry or a double submit can never log (or send) a second email.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emailLog } from "@/lib/db/schema";
import { expectRejected, insertFixture, rolledBack } from "./helpers";

describe("email_log", () => {
  it("is unique on (kind, event_id)", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx); // already has a PAYMENT_RECEIVED row for ids.event
      await expectRejected(
        tx,
        sql`INSERT INTO email_log (kind, policy_id, recipient, status, provider_id, event_id)
            VALUES ('PAYMENT_RECEIVED', ${ids.policy}, 'delivered@resend.dev', 'sent', 'email_1', ${ids.event})`,
        /email_log_kind_event_unique/,
      );
      // ON CONFLICT DO NOTHING (what the app uses) writes nothing.
      const inserted = await tx
        .insert(emailLog)
        .values({ kind: "PAYMENT_RECEIVED", policyId: ids.policy, recipient: "x@y.test", status: "skipped", error: "dup", eventId: ids.event })
        .onConflictDoNothing()
        .returning({ id: emailLog.id });
      expect(inserted).toEqual([]);
      // Another kind for the same event is allowed.
      await tx
        .insert(emailLog)
        .values({ kind: "COVERAGE_DATE_CORRECTED", policyId: ids.policy, recipient: "x@y.test", status: "sent", providerId: "email_2", eventId: ids.event });
      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM email_log WHERE event_id = ${ids.event}`);
      expect(rows.rows[0]).toEqual({ n: 2 });
    });
  });

  it("a sent row needs a provider id, and only a sent row has one", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`INSERT INTO email_log (kind, policy_id, recipient, status, event_id)
            VALUES ('COVERAGE_DATE_CORRECTED', ${ids.policy}, 'a@b.test', 'sent', ${ids.event})`,
        /email_log_provider_id_iff_sent/,
      );
      await expectRejected(
        tx,
        sql`INSERT INTO email_log (kind, policy_id, recipient, status, provider_id, event_id)
            VALUES ('COVERAGE_DATE_CORRECTED', ${ids.policy}, 'a@b.test', 'failed', 'email_3', ${ids.event})`,
        /email_log_provider_id_iff_sent/,
      );
    });
  });
});
