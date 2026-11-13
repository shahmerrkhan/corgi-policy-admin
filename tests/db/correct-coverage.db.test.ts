// correctCoverageCommand against the real database, always rolled back.
// Policy 2026-01-01 ($730), Liquor Liability added effective 2026-03-01 ($612.00), paid in
// full by one $1,342.00 Stripe payment dated 2026-03-05, then corrected to 2026-02-22.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ledgerEntries, paymentAllocations, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { addCoverageCommand } from "@/lib/services/add-coverage";
import { correctCoverageCommand } from "@/lib/services/correct-coverage";
import type { CorrectCoverageInput } from "@/lib/services/inputs";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import type { Reader } from "@/lib/services/read-models";
import { recordStripePaymentCommand } from "@/lib/services/record-stripe-payment";
import { getStatementForBroker } from "@/lib/services/statement";
import { expectRejected, insertBrokerWithCustomer, rolledBack } from "./helpers";

const FIX: CorrectCoverageInput = { newEffectiveDate: "2026-02-22", transactionDate: "2026-03-22", reason: "Keyed the wrong start date" };

async function setup(tx: Tx, { pay = true } = {}) {
  const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
  const broker = { brokerId, clerkUserId: "user_testbroker" };
  const issued = await issuePolicyCommand(tx, broker, {
    customerId,
    termStart: "2026-01-01",
    transactionDate: "2026-01-01",
    limitCents: 7_300_000,
    rateBps: 100,
  });
  if (!issued.ok) throw new Error(issued.code);
  const policyId = issued.value.policyId;
  const lineId = randomUUID();
  const added = await addCoverageCommand(tx, broker, policyId, lineId, {
    name: "Liquor Liability",
    limitCents: 7_300_000,
    rateBps: 100,
    effectiveDate: "2026-03-01",
    transactionDate: "2026-03-01",
  });
  if (!added.ok) throw new Error(added.code);
  if (pay) {
    const tag = randomUUID().slice(0, 8);
    const paid = await recordStripePaymentCommand(tx, {
      eventId: `evt_test_${tag}`,
      eventType: "checkout.session.completed",
      created: 1_772_730_000, // 2026-03-05 in Toronto
      livemode: false,
      sessionId: `cs_test_${tag}`,
      paymentIntentId: `pi_test_${tag}`,
      policyId,
      currency: "usd",
      amountTotal: 134_200,
    });
    if (paid.outcome !== "recorded") throw new Error(paid.outcome);
  }
  return { broker, policyId, lineId, chargeId: added.value.chargeId };
}

async function rows(tx: Tx, policyId: string) {
  return {
    entries: await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId)).orderBy(ledgerEntries.seq),
    events: await tx.select().from(policyEvents).where(eq(policyEvents.policyId, policyId)).orderBy(policyEvents.position),
    allocations: await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId)),
  };
}

describe("correctCoverageCommand", () => {
  it("fully paid $612.00 corrected to $626.00: reversal, rebook, release and FIFO in one event; balance due $14.00", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const requestId = randomUUID();
      const r = await correctCoverageCommand(tx, broker, policyId, requestId, { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      expect(r).toMatchObject({ ok: true, value: { policyId, eventId: requestId, alreadyCorrected: false } });
      if (!r.ok) return;

      const { entries, events, allocations } = await rows(tx, policyId);
      const event = events.at(-1)!;
      expect(event).toMatchObject({
        id: requestId,
        type: "COVERAGE_DATE_CORRECTED",
        transactionDate: "2026-03-22",
        actorRole: "broker",
        actorUserId: "user_testbroker",
        payload: {
          coverageLineId: lineId,
          coverageName: "Liquor Liability",
          oldEffectiveDate: "2026-03-01",
          newEffectiveDate: "2026-02-22",
          reason: "Keyed the wrong start date",
          oldChargeId: chargeId,
          oldAmountCents: 61_200,
          newChargeId: r.value.newChargeId,
          newAmountCents: 62_600,
          netChangeCents: 1_400,
          oldDaysInEffect: 306,
          newDaysInEffect: 313,
          daysInTerm: 365,
        },
      });
      const reversal = entries.find((e) => e.type === "REVERSAL")!;
      expect(reversal).toMatchObject({ eventId: requestId, amountCents: -61_200, reversesEntryId: chargeId, date: "2026-03-22", seq: 4 });
      expect(entries.find((e) => e.id === r.value.newChargeId)).toMatchObject({
        type: "CHARGE",
        eventId: requestId,
        seq: 5,
        amountCents: 62_600,
        premiumCents: 73_000,
        effectiveDate: "2026-02-22",
        daysInEffect: 313,
        daysInTerm: 365,
        rebookOf: chargeId,
        coverageLineId: lineId,
      });
      expect((event.payload as { reversalId: string }).reversalId).toBe(reversal.id);
      const mine = allocations.filter((a) => a.eventId === requestId).map((a) => [a.chargeId, a.amountCents, a.sourceEntryId]);
      expect(mine).toEqual([
        [chargeId, -61_200, reversal.id],
        [r.value.newChargeId, 61_200, r.value.newChargeId],
      ]);

      const statement = await getStatementForBroker(broker.brokerId, policyId, tx as unknown as Reader);
      expect(statement!.balance).toEqual({ kind: "due", cents: 1_400 });
      expect(statement!.rows.map((x) => [x.type, x.amountCents, x.description])).toEqual([
        ["CHARGE", 73_000, "Premium, policy issued"],
        ["CHARGE", 61_200, "Premium, Liquor Liability"],
        ["PAYMENT", -134_200, "Payment"],
        ["REVERSAL", -61_200, "Reversal of #2"],
        ["CHARGE", 62_600, "Premium, Liquor Liability (corrected)"],
      ]);
      expect(statement!.rows[1]!.reversedBy).toEqual({ id: reversal.id, seq: 4 });
      expect(statement!.coverageLines[0]).toMatchObject({ effectiveDate: "2026-02-22", liveChargeId: r.value.newChargeId });
      expect(statement!.events[0]).toMatchObject({ label: "Coverage date corrected", detail: expect.stringContaining("Reason: Keyed") });
    });
  });

  it("unpaid: balance rises by exactly +$14.00", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx, { pay: false });
      const r = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      expect(r.ok).toBe(true);
      const statement = await getStatementForBroker(broker.brokerId, policyId, tx as unknown as Reader);
      expect(statement!.balance).toEqual({ kind: "due", cents: 73_000 + 62_600 });
      expect((await rows(tx, policyId)).allocations).toEqual([]);
    });
  });

  it("double submit with the same request id creates one correction", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const requestId = randomUUID();
      const target = { coverageLineId: lineId, expectedChargeId: chargeId };
      const first = await correctCoverageCommand(tx, broker, policyId, requestId, target, FIX);
      const second = await correctCoverageCommand(tx, broker, policyId, requestId, target, FIX);
      expect(first).toMatchObject({ ok: true, value: { alreadyCorrected: false } });
      expect(second).toMatchObject({ ok: true, value: { alreadyCorrected: true } });
      expect(first.ok && second.ok && first.value.newChargeId === second.value.newChargeId).toBe(true);
      const { entries, events } = await rows(tx, policyId);
      expect(entries.filter((e) => e.type === "REVERSAL")).toHaveLength(1);
      expect(entries.filter((e) => e.rebookOf !== null)).toHaveLength(1);
      expect(events.filter((e) => e.type === "COVERAGE_DATE_CORRECTED")).toHaveLength(1);
    });
  });

  it("rejects a request id already used by another event", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const otherEvent = (await rows(tx, policyId)).events[0]!.id;
      const r = await correctCoverageCommand(tx, broker, policyId, otherEvent, { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      expect(r).toMatchObject({ ok: false, code: "REQUEST_ID_CONFLICT" });
    });
  });

  it("corrects twice; a stale review of the original is refused with the latest charge", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const first = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      if (!first.ok) throw new Error(first.code);
      const stale = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, {
        ...FIX,
        newEffectiveDate: "2026-02-15",
      });
      expect(stale).toMatchObject({ ok: false, code: "CHARGE_ALREADY_REVERSED", latestChargeId: first.value.newChargeId });
      const second = await correctCoverageCommand(
        tx,
        broker,
        policyId,
        randomUUID(),
        { coverageLineId: lineId, expectedChargeId: first.value.newChargeId },
        { ...FIX, newEffectiveDate: "2026-02-15", transactionDate: "2026-03-25" },
      );
      if (!second.ok) throw new Error(second.code);
      const { entries } = await rows(tx, policyId);
      expect(entries.find((e) => e.id === second.value.newChargeId)).toMatchObject({ amountCents: 64_000, rebookOf: first.value.newChargeId });
      const statement = await getStatementForBroker(broker.brokerId, policyId, tx as unknown as Reader);
      expect(statement!.balance).toEqual({ kind: "due", cents: 64_000 - 61_200 });
    });
  });

  it.each([
    ["a transaction date before the latest entry", { transactionDate: "2026-03-04" }, "TRANSACTION_DATE_TOO_EARLY"],
    ["the same date", { newEffectiveDate: "2026-03-01" }, "SAME_EFFECTIVE_DATE"],
    ["a date on the term end", { newEffectiveDate: "2027-01-01" }, "EFFECTIVE_DATE_OUTSIDE_TERM"],
  ])("rejects %s and writes nothing", async (_l, over, code) => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const before = await rows(tx, policyId);
      const r = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, { ...FIX, ...over });
      expect(r).toMatchObject({ ok: false, code });
      const after = await rows(tx, policyId);
      expect([after.entries.length, after.events.length, after.allocations.length]).toEqual([
        before.entries.length,
        before.events.length,
        before.allocations.length,
      ]);
    });
  });

  it("another broker's policy is not found", async () => {
    await rolledBack(async (tx) => {
      const { policyId, lineId, chargeId } = await setup(tx);
      const other = await insertBrokerWithCustomer(tx);
      const r = await correctCoverageCommand(tx, { brokerId: other.brokerId, clerkUserId: "user_x" }, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      expect(r).toMatchObject({ ok: false, code: "POLICY_NOT_FOUND" });
    });
  });

  it("DB checks reject a second rebook, a second original charge per line, a rebook without days, a wrong amount and a bad reason", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const r = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      if (!r.ok) throw new Error(r.code);
      const ev = r.value.eventId;
      const insertCharge = (seq: number, amount: number, extra: { rebookOf?: string | null; days?: number | null; eff?: string }) =>
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, effective_date, premium_cents,
              coverage_line_id, rebook_of, days_in_effect, days_in_term)
            VALUES (${policyId}, ${ev}, 'CHARGE', '2026-03-22', ${seq}, ${amount}, ${extra.eff ?? "2026-02-22"}, 73000,
              ${lineId}, ${extra.rebookOf ?? null}, ${extra.days ?? null}, ${extra.days == null ? null : 365})`;

      await expectRejected(tx, insertCharge(20, 62_600, { rebookOf: chargeId, days: 313 }), /ledger_entries_one_rebook_per_charge/);
      await expectRejected(tx, insertCharge(21, 61_200, { rebookOf: null, days: 306, eff: "2026-03-01" }), /ledger_entries_one_original_charge_per_line/);
      await expectRejected(tx, insertCharge(22, 62_600, { rebookOf: r.value.newChargeId, days: null }), /ledger_entries_rebook_has_days/);
      await expectRejected(tx, insertCharge(23, 62_601, { rebookOf: r.value.newChargeId, days: 313 }), /ledger_entries_charge_prorated_round_half_up/);
      for (const reason of ["   ", "x".repeat(501)]) {
        await expectRejected(
          tx,
          sql`INSERT INTO policy_events (policy_id, type, transaction_date, actor_role, payload)
              VALUES (${policyId}, 'COVERAGE_DATE_CORRECTED', '2026-03-22', 'broker', ${JSON.stringify({ reason })}::jsonb)`,
          /policy_events_correction_reason/,
        );
      }
    });
  });

  it("append-only triggers still block UPDATE and DELETE on the correction's rows", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId, lineId, chargeId } = await setup(tx);
      const r = await correctCoverageCommand(tx, broker, policyId, randomUUID(), { coverageLineId: lineId, expectedChargeId: chargeId }, FIX);
      if (!r.ok) throw new Error(r.code);
      const [alloc] = (await rows(tx, policyId)).allocations.filter((a) => a.eventId === r.value.eventId);
      const id = r.value.newChargeId;
      await expectRejected(tx, sql`UPDATE ledger_entries SET amount_cents = 61200 WHERE id = ${id}`, /append-only: UPDATE on ledger_entries/);
      await expectRejected(tx, sql`DELETE FROM ledger_entries WHERE id = ${id}`, /append-only: DELETE on ledger_entries/);
      await expectRejected(tx, sql`UPDATE payment_allocations SET amount_cents = 1 WHERE id = ${alloc!.id}`, /append-only: UPDATE on payment_allocations/);
      await expectRejected(tx, sql`DELETE FROM payment_allocations WHERE id = ${alloc!.id}`, /append-only: DELETE on payment_allocations/);
      await expectRejected(tx, sql`UPDATE policy_events SET payload = '{}' WHERE id = ${r.value.eventId}`, /append-only: UPDATE on policy_events/);
      await expectRejected(tx, sql`DELETE FROM policy_events WHERE id = ${r.value.eventId}`, /append-only: DELETE on policy_events/);
    });
  });
});
