// recordStripePaymentCommand against the real database, always rolled back: one payment,
// one PAYMENT entry and FIFO allocations per paid session; duplicates and ignored events
// write nothing else; balance = charges - payments; allocations sum to the cash applied.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assertInvariants, balanceCents, paymentUnapplied } from "@/lib/domain";
import { allocationFromRow, entryFromRow, paymentFromRow } from "@/lib/db/mappers";
import {
  coverageLines,
  ledgerEntries,
  paymentAllocations,
  payments,
  paymentStatusEvents,
  policyEvents,
  stripeEvents,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import type { Reader } from "@/lib/services/read-models";
import { recordStripePaymentCommand } from "@/lib/services/record-stripe-payment";
import { getStatementForCustomer } from "@/lib/services/statement";
import type { CheckoutCompleted } from "@/lib/services/stripe-webhook";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

const NOV_12_UTC = 1794441600; // 2026-11-12T00:00Z = 2026-11-11 in Toronto

/** A policy with a 73,000 premium charge (posted 2026-01-01) and, optionally, a 20,000 coverage charge (2026-02-01). */
async function setup(tx: Tx, { secondCharge = false } = {}) {
  const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
  const issued = await issuePolicyCommand(
    tx,
    { brokerId, clerkUserId: "user_testbroker" },
    { customerId, termStart: "2026-01-01", transactionDate: "2026-01-01", limitCents: 7_300_000, rateBps: 100 },
  );
  if (!issued.ok) throw new Error(issued.code);
  const { policyId, chargeId } = issued.value;
  let secondChargeId: string | null = null;
  if (secondCharge) {
    const eventId = randomUUID();
    const lineId = randomUUID();
    secondChargeId = randomUUID();
    await tx.insert(policyEvents).values({ id: eventId, policyId, type: "COVERAGE_ADDED", transactionDate: "2026-02-01", actorRole: "broker" });
    await tx.insert(coverageLines).values({ id: lineId, policyId, eventId, name: "Line", limitCents: 2_000_000, rateBps: 100, premiumCents: 20_000 });
    await tx.insert(ledgerEntries).values({
      id: secondChargeId,
      policyId,
      eventId,
      type: "CHARGE",
      date: "2026-02-01",
      seq: 2,
      amountCents: 20_000,
      effectiveDate: "2026-01-01",
      premiumCents: 20_000,
      coverageLineId: lineId,
    });
  }
  return { customerId, policyId, chargeId, secondChargeId };
}

function event(policyId: string | null, over: Partial<CheckoutCompleted> = {}): CheckoutCompleted {
  const n = randomUUID().slice(0, 8);
  return {
    eventId: `evt_test_${n}`,
    eventType: "checkout.session.completed",
    livemode: false,
    created: NOV_12_UTC,
    sessionId: `cs_test_${n}`,
    paymentIntentId: `pi_test_${n}`,
    amountTotal: 73_000,
    currency: "usd",
    policyId,
    ...over,
  };
}

async function state(tx: Tx, policyId: string) {
  const entryRows = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId));
  const allocationRows = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId));
  const paymentRows = await tx.select().from(payments).where(eq(payments.policyId, policyId));
  const events = await tx.select().from(policyEvents).where(eq(policyEvents.policyId, policyId));
  const statusEvents = paymentRows.length
    ? await tx.select().from(paymentStatusEvents).where(eq(paymentStatusEvents.paymentId, paymentRows[0]!.id))
    : [];
  const ledger = {
    entries: entryRows.map(entryFromRow),
    allocations: allocationRows.map(allocationFromRow),
    payments: paymentRows.map(paymentFromRow),
  };
  return { entryRows, allocationRows, paymentRows, events, statusEvents, ledger };
}

async function gateRows(tx: Tx, eventId: string) {
  return tx.select().from(stripeEvents).where(eq(stripeEvents.stripeEventId, eventId));
}

describe("recordStripePaymentCommand", () => {
  it("records one payment, one PAYMENT entry and FIFO allocations, oldest charge first", async () => {
    await rolledBack(async (tx) => {
      const { policyId, chargeId, secondChargeId } = await setup(tx, { secondCharge: true });
      const ev = event(policyId, { amountTotal: 80_000 });
      const r = await recordStripePaymentCommand(tx, ev);
      expect(r.outcome).toBe("recorded");

      const s = await state(tx, policyId);
      expect(s.paymentRows).toHaveLength(1);
      const payment = s.paymentRows[0]!;
      expect(payment).toMatchObject({
        amountCents: 80_000,
        status: "succeeded",
        date: "2026-11-11",
        seq: 1,
        currency: "usd",
        stripePaymentIntentId: ev.paymentIntentId,
        stripeCheckoutSessionId: ev.sessionId,
        stripeEventId: ev.eventId,
      });

      const paymentEntries = s.entryRows.filter((e) => e.type === "PAYMENT");
      expect(paymentEntries).toHaveLength(1);
      const entry = paymentEntries[0]!;
      expect(entry).toMatchObject({ amountCents: -80_000, paymentId: payment.id, date: "2026-11-11", seq: 3 });

      const recorded = s.events.filter((e) => e.type === "PAYMENT_RECORDED");
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ actorRole: "stripe", actorUserId: null, transactionDate: "2026-11-11" });
      expect(entry.eventId).toBe(recorded[0]!.id);
      expect(recorded[0]!.payload).toMatchObject({ paymentId: payment.id, amountCents: 80_000, stripeEventId: ev.eventId });

      expect(s.allocationRows.map((a) => [a.chargeId, a.amountCents])).toEqual([
        [chargeId, 73_000],
        [secondChargeId, 7_000],
      ]);
      for (const a of s.allocationRows) {
        expect(a).toMatchObject({ paymentId: payment.id, sourceEntryId: entry.id, eventId: recorded[0]!.id });
      }
      expect(s.statusEvents).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: "succeeded", stripeEventId: ev.eventId }),
      ]);
      expect(await gateRows(tx, ev.eventId)).toEqual([expect.objectContaining({ outcome: "recorded", reason: null })]);

      // Balance = charges - payments; allocations sum to the cash applied (all of it here).
      expect(balanceCents(s.ledger.entries)).toBe(73_000 + 20_000 - 80_000);
      expect(s.allocationRows.reduce((t, a) => t + a.amountCents, 0)).toBe(80_000);
      expect(paymentUnapplied(s.ledger.payments[0]!, s.ledger.entries, s.ledger.allocations)).toBe(0);
      assertInvariants(s.ledger);
    });
  });

  it("is a no-op when the same event is delivered twice", async () => {
    await rolledBack(async (tx) => {
      const { policyId } = await setup(tx);
      const ev = event(policyId);
      expect((await recordStripePaymentCommand(tx, ev)).outcome).toBe("recorded");
      expect(await recordStripePaymentCommand(tx, ev)).toEqual({ outcome: "duplicate" });

      const s = await state(tx, policyId);
      expect(s.paymentRows).toHaveLength(1);
      expect(s.entryRows.filter((e) => e.type === "PAYMENT")).toHaveLength(1);
      expect(s.allocationRows).toHaveLength(1);
      expect(s.events.filter((e) => e.type === "PAYMENT_RECORDED")).toHaveLength(1);
      expect(await gateRows(tx, ev.eventId)).toHaveLength(1);
      expect(balanceCents(s.ledger.entries)).toBe(0);
    });
  });

  it("ignores a second event for an already-recorded payment intent or session", async () => {
    await rolledBack(async (tx) => {
      const { policyId } = await setup(tx);
      const first = event(policyId);
      await recordStripePaymentCommand(tx, first);
      const samePi = event(policyId, { paymentIntentId: first.paymentIntentId });
      expect(await recordStripePaymentCommand(tx, samePi)).toEqual({ outcome: "ignored", reason: "DUPLICATE_PAYMENT_INTENT" });
      const sameSession = event(policyId, { sessionId: first.sessionId });
      expect(await recordStripePaymentCommand(tx, sameSession)).toEqual({
        outcome: "ignored",
        reason: "DUPLICATE_CHECKOUT_SESSION",
      });
      expect((await state(tx, policyId)).paymentRows).toHaveLength(1);
      expect(await gateRows(tx, samePi.eventId)).toEqual([
        expect.objectContaining({ outcome: "ignored", reason: "DUPLICATE_PAYMENT_INTENT" }),
      ]);
    });
  });

  it("leaves an overpayment as unapplied cash on the account", async () => {
    await rolledBack(async (tx) => {
      const { customerId, policyId, chargeId } = await setup(tx);
      await recordStripePaymentCommand(tx, event(policyId, { amountTotal: 100_000 }));
      const s = await state(tx, policyId);
      expect(s.allocationRows.map((a) => [a.chargeId, a.amountCents])).toEqual([[chargeId, 73_000]]);
      expect(paymentUnapplied(s.ledger.payments[0]!, s.ledger.entries, s.ledger.allocations)).toBe(27_000);
      expect(balanceCents(s.ledger.entries)).toBe(-27_000);
      assertInvariants(s.ledger);
      const statement = await getStatementForCustomer(customerId, policyId, tx as unknown as Reader);
      expect(statement?.balance).toEqual({ kind: "credit", cents: 27_000 });
    });
  });

  it("applies a second payment to what is still open, and a full payment reads Balance due $0.00", async () => {
    await rolledBack(async (tx) => {
      const { customerId, policyId, secondChargeId } = await setup(tx, { secondCharge: true });
      await recordStripePaymentCommand(tx, event(policyId, { amountTotal: 80_000 }));
      const second = await recordStripePaymentCommand(tx, event(policyId, { amountTotal: 13_000 }));
      expect(second.outcome).toBe("recorded");
      const s = await state(tx, policyId);
      expect(s.paymentRows.map((p) => p.seq).sort()).toEqual([1, 2]);
      const secondAllocations = s.allocationRows.filter((a) => second.outcome === "recorded" && a.paymentId === second.paymentId);
      expect(secondAllocations.map((a) => [a.chargeId, a.amountCents])).toEqual([[secondChargeId, 13_000]]);
      expect(balanceCents(s.ledger.entries)).toBe(0);
      assertInvariants(s.ledger);

      const statement = await getStatementForCustomer(customerId, policyId, tx as unknown as Reader);
      expect(statement?.balance).toEqual({ kind: "due", cents: 0 });
      const paymentRows = statement!.rows.filter((r) => r.type === "PAYMENT");
      expect(paymentRows.map((r) => [r.description, r.amountCents])).toEqual([
        ["Payment", -80_000],
        ["Payment", -13_000],
      ]);
      const timeline = statement!.events.filter((e) => e.type === "PAYMENT_RECORDED");
      expect(timeline).toHaveLength(2);
      for (const e of timeline) expect(e).toMatchObject({ label: "Payment recorded", actor: "System", paymentStatus: "succeeded" });
    });
  });

  it.each([
    ["an unknown policy", () => event(randomUUID()), "UNKNOWN_POLICY"],
    ["a non-uuid policy id", () => event("CGL-000050"), "UNKNOWN_POLICY"],
    ["missing metadata", () => event(null), "UNKNOWN_POLICY"],
    ["a currency mismatch", (p: string) => event(p, { currency: "cad" }), "CURRENCY_MISMATCH"],
    ["a live-mode event", (p: string) => event(p, { livemode: true }), "LIVE_MODE"],
    ["a missing amount", (p: string) => event(p, { amountTotal: null }), "INVALID_AMOUNT"],
    ["a zero amount", (p: string) => event(p, { amountTotal: 0 }), "INVALID_AMOUNT"],
    ["a missing payment intent", (p: string) => event(p, { paymentIntentId: null }), "INVALID_PAYMENT_INTENT"],
  ])("stores %s as ignored with a reason and writes nothing else", async (_label, make, reason) => {
    await rolledBack(async (tx) => {
      const { policyId } = await setup(tx);
      const before = await state(tx, policyId);
      const ev = make(policyId);
      expect(await recordStripePaymentCommand(tx, ev)).toEqual({ outcome: "ignored", reason });
      expect(await gateRows(tx, ev.eventId)).toEqual([
        expect.objectContaining({ outcome: "ignored", reason, stripeCheckoutSessionId: ev.sessionId }),
      ]);
      const after = await state(tx, policyId);
      expect(after.paymentRows).toHaveLength(0);
      expect(after.entryRows).toHaveLength(before.entryRows.length);
      expect(after.allocationRows).toHaveLength(0);
      expect(after.events).toHaveLength(before.events.length);
      // Redelivery of an ignored event is a duplicate, still one row.
      expect(await recordStripePaymentCommand(tx, ev)).toEqual({ outcome: "duplicate" });
      expect(await gateRows(tx, ev.eventId)).toHaveLength(1);
    });
  });
});
