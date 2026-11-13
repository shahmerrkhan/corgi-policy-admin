import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ledgerEntries, payments } from "@/lib/db/schema";
import { expectAccepted, expectRejected, insertFixture, rolledBack } from "./helpers";

describe("policies: only active -> cancelled", () => {
  it("allows cancelling an active policy", async () => {
    await rolledBack(async (tx) => {
      const { policy } = await insertFixture(tx);
      await expectAccepted(
        tx,
        sql`UPDATE policies SET status = 'cancelled', cancel_date = '2026-06-01',
            cancel_reason = 'Closed business', updated_at = now() WHERE id = ${policy}`,
      );
      const res = await tx.execute(sql`SELECT status, cancel_date FROM policies WHERE id = ${policy}`);
      expect(res.rows[0]).toEqual({ status: "cancelled", cancel_date: "2026-06-01" });
    });
  });

  it("rejects every other change, DELETE and TRUNCATE", async () => {
    await rolledBack(async (tx) => {
      const { policy } = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`UPDATE policies SET limit_cents = 200000000, premium_cents = 2000000 WHERE id = ${policy}`,
        /policies: status change active -> active is not allowed/,
      );
      await expectRejected(
        tx,
        sql`UPDATE policies SET status = 'cancelled', cancel_date = '2026-06-01', cancel_reason = 'x',
            rate_bps = 200, premium_cents = 2000000 WHERE id = ${policy}`,
        /policies: only status, cancel_date, cancel_reason and updated_at may change/,
      );
      await expectRejected(tx, sql`DELETE FROM policies WHERE id = ${policy}`, /append-only: DELETE on policies/);
      await expectRejected(tx, sql`TRUNCATE policies CASCADE`, /append-only: TRUNCATE on policies/);

      await expectAccepted(
        tx,
        sql`UPDATE policies SET status = 'cancelled', cancel_date = '2026-06-01',
            cancel_reason = 'Closed business' WHERE id = ${policy}`,
      );
      await expectRejected(
        tx,
        sql`UPDATE policies SET status = 'active', cancel_date = NULL, cancel_reason = NULL WHERE id = ${policy}`,
        /policies: status change cancelled -> active is not allowed/,
      );
    });
  });
});

describe("payments: only pending -> succeeded | failed", () => {
  it("allows pending -> succeeded and pending -> failed", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectAccepted(tx, sql`UPDATE payments SET status = 'succeeded', updated_at = now() WHERE id = ${ids.payment}`);

      const second = randomUUID();
      await tx.insert(payments).values({
        id: second,
        policyId: ids.policy,
        date: "2026-02-01",
        seq: 2,
        amountCents: 500,
        stripePaymentIntentId: `pi_test_${second}`,
        stripeCheckoutSessionId: `cs_test_${second}`,
        stripeEventId: `evt_test_${second}`,
        currency: "usd",
      });
      await expectAccepted(tx, sql`UPDATE payments SET status = 'failed' WHERE id = ${second}`);

      const res = await tx.execute(
        sql`SELECT status FROM payments WHERE id IN (${ids.payment}, ${second}) ORDER BY seq`,
      );
      expect(res.rows).toEqual([{ status: "succeeded" }, { status: "failed" }]);
    });
  });

  it("rejects other transitions, other columns, DELETE and TRUNCATE", async () => {
    await rolledBack(async (tx) => {
      const { payment } = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`UPDATE payments SET amount_cents = 1 WHERE id = ${payment}`,
        /payments: status change pending -> pending is not allowed/,
      );
      await expectRejected(
        tx,
        sql`UPDATE payments SET status = 'succeeded', amount_cents = 1 WHERE id = ${payment}`,
        /payments: only status and updated_at may change/,
      );
      await expectRejected(tx, sql`DELETE FROM payments WHERE id = ${payment}`, /append-only: DELETE on payments/);
      await expectRejected(tx, sql`TRUNCATE payments CASCADE`, /append-only: TRUNCATE on payments/);

      await expectAccepted(tx, sql`UPDATE payments SET status = 'succeeded' WHERE id = ${payment}`);
      await expectRejected(
        tx,
        sql`UPDATE payments SET status = 'pending' WHERE id = ${payment}`,
        /payments: status change succeeded -> pending is not allowed/,
      );
      await expectRejected(
        tx,
        sql`UPDATE payments SET status = 'failed' WHERE id = ${payment}`,
        /payments: status change succeeded -> failed is not allowed/,
      );
    });
  });

  it("rejects a second payment with the same Stripe payment intent", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`INSERT INTO payments (policy_id, date, seq, amount_cents, stripe_payment_intent_id,
              stripe_checkout_session_id, stripe_event_id, currency)
            VALUES (${ids.policy}, '2026-02-01', 9, 100, ${`pi_test_${ids.payment}`}, 'cs_test_other', 'evt_test_other', 'usd')`,
        /payments_stripe_payment_intent_id_unique/,
      );
    });
  });

  it("rejects a reused checkout session or event id, a non-USD currency, and freezes the Stripe columns", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`INSERT INTO payments (policy_id, date, seq, amount_cents, stripe_payment_intent_id,
              stripe_checkout_session_id, stripe_event_id, currency)
            VALUES (${ids.policy}, '2026-02-01', 9, 100, 'pi_test_other', ${`cs_test_${ids.payment}`}, 'evt_test_other', 'usd')`,
        /payments_stripe_checkout_session_id_unique/,
      );
      await expectRejected(
        tx,
        sql`INSERT INTO payments (policy_id, date, seq, amount_cents, stripe_payment_intent_id,
              stripe_checkout_session_id, stripe_event_id, currency)
            VALUES (${ids.policy}, '2026-02-01', 9, 100, 'pi_test_other', 'cs_test_other', ${`evt_test_${ids.payment}`}, 'usd')`,
        /payments_stripe_event_id_unique/,
      );
      await expectRejected(
        tx,
        sql`INSERT INTO payments (policy_id, date, seq, amount_cents, stripe_payment_intent_id,
              stripe_checkout_session_id, stripe_event_id, currency)
            VALUES (${ids.policy}, '2026-02-01', 9, 100, 'pi_test_other', 'cs_test_other', 'evt_test_other', 'cad')`,
        /payments_currency_usd/,
      );
      await expectRejected(
        tx,
        sql`UPDATE payments SET status = 'succeeded', stripe_checkout_session_id = 'cs_changed' WHERE id = ${ids.payment}`,
        /payments: only status and updated_at may change/,
      );
    });
  });
});

describe("ledger_entries Stripe refund id", () => {
  it("requires it on REFUND, keeps it unique, and forbids it on other types", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, payment_id)
            VALUES (${ids.policy}, ${ids.event}, 'REFUND', '2026-06-02', 10, 100, ${ids.payment})`,
        /ledger_entries_refund_shape/,
      );
      await tx.insert(ledgerEntries).values({
        policyId: ids.policy,
        eventId: ids.event,
        type: "REFUND",
        date: "2026-06-02",
        seq: 11,
        amountCents: 100,
        paymentId: ids.payment,
        stripeRefundId: "re_test_1",
      });
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, payment_id, stripe_refund_id)
            VALUES (${ids.policy}, ${ids.event}, 'REFUND', '2026-06-02', 12, 100, ${ids.payment}, 're_test_1')`,
        /ledger_entries_stripe_refund_id_unique/,
      );
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, payment_id, stripe_refund_id)
            VALUES (${ids.policy}, ${ids.event}, 'PAYMENT', '2026-06-02', 13, -100, ${ids.payment}, 're_test_2')`,
        /ledger_entries_payment_shape/,
      );
    });
  });

  it("rejects a duplicate seq on the same policy", async () => {
    await rolledBack(async (tx) => {
      const ids = await insertFixture(tx);
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, reverses_entry_id)
            VALUES (${ids.policy}, ${ids.event}, 'REVERSAL', '2026-02-01', 1, -1000000, ${ids.charge})`,
        /ledger_entries_policy_seq_unique/,
      );
    });
  });
});
