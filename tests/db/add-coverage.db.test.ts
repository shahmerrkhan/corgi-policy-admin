// addCoverageCommand against the real database, always rolled back.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { coverageLines, ledgerEntries, paymentAllocations, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { addCoverageCommand, previewAddCoverage } from "@/lib/services/add-coverage";
import type { AddCoverageInput } from "@/lib/services/inputs";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import { recordStripePaymentCommand } from "@/lib/services/record-stripe-payment";
import type { Reader } from "@/lib/services/read-models";
import { getStatementForBroker } from "@/lib/services/statement";
import { expectRejected, insertBrokerWithCustomer, rolledBack } from "./helpers";

const LIQUOR: AddCoverageInput = {
  name: "Liquor Liability",
  limitCents: 7_300_000,
  rateBps: 100,
  effectiveDate: "2026-03-01",
  transactionDate: "2026-11-13",
};

/** A broker with a $730 policy, 2026-01-01 to 2027-01-01. */
async function setup(tx: Tx) {
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
  return { broker, policyId: issued.value.policyId, issueChargeId: issued.value.chargeId };
}

async function rows(tx: Tx, policyId: string) {
  return {
    lines: await tx.select().from(coverageLines).where(eq(coverageLines.policyId, policyId)),
    entries: await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId)).orderBy(ledgerEntries.seq),
    events: await tx.select().from(policyEvents).where(eq(policyEvents.policyId, policyId)).orderBy(policyEvents.position),
    allocations: await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId)),
  };
}

describe("addCoverageCommand", () => {
  it("writes one line, one $612.00 CHARGE with its day counts and one COVERAGE_ADDED event, all linked", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const requestId = randomUUID();
      const r = await addCoverageCommand(tx, broker, policyId, requestId, LIQUOR);
      expect(r).toMatchObject({ ok: true, value: { policyId, coverageLineId: requestId, alreadyAdded: false } });
      if (!r.ok) return;

      const { lines, entries, events, allocations } = await rows(tx, policyId);
      expect(lines).toHaveLength(1);
      const event = events[1]!;
      expect(event).toMatchObject({
        type: "COVERAGE_ADDED",
        transactionDate: "2026-11-13",
        actorRole: "broker",
        actorUserId: "user_testbroker",
        payload: {
          coverageLineId: requestId,
          name: "Liquor Liability",
          limitCents: 7_300_000,
          rateBps: 100,
          premiumCents: 73_000,
          effectiveDate: "2026-03-01",
          daysInEffect: 306,
          daysInTerm: 365,
          chargeCents: 61_200,
        },
      });
      expect(lines[0]).toMatchObject({ id: requestId, eventId: event.id, name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100, premiumCents: 73_000 });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ seq: 1, daysInEffect: 365, daysInTerm: 365 });
      expect(entries[1]).toMatchObject({
        id: r.value.chargeId,
        type: "CHARGE",
        eventId: event.id,
        seq: 2,
        date: "2026-11-13",
        amountCents: 61_200,
        premiumCents: 73_000,
        effectiveDate: "2026-03-01",
        daysInEffect: 306,
        daysInTerm: 365,
        coverageLineId: requestId,
        rebookOf: null,
      });
      expect(allocations).toEqual([]);

      // The statement shows it and the balance rises by exactly the previewed amount.
      const statement = await getStatementForBroker(broker.brokerId, policyId, tx as unknown as Reader);
      expect(statement!.balance).toEqual({ kind: "due", cents: 73_000 + 61_200 });
      expect(statement!.rows[1]).toMatchObject({ description: "Premium, Liquor Liability", amountCents: 61_200 });
      expect(statement!.rows[1]!.calculation).toMatchObject({ daysInEffect: 306, termDays: 365, matchesStored: true });
      expect(statement!.events[0]).toMatchObject({ label: "Coverage added", relatedEntries: [{ id: r.value.chargeId, seq: 2 }] });
    });
  });

  it("the preview matches what the command writes", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const preview = await previewAddCoverage(broker.brokerId, policyId, LIQUOR, tx as unknown as Reader);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.plan.entries[0].amountCents).toBe(61_200);
      expect(preview.value.plan.backdatedOver30Days).toBe(true);
      expect(preview.value.explanation).toMatchObject({ daysInEffect: 306, termDays: 365, matchesStored: true });
      const r = await addCoverageCommand(tx, broker, policyId, randomUUID(), LIQUOR);
      const { entries } = await rows(tx, policyId);
      expect(r.ok && entries.find((e) => e.id === r.value.chargeId)?.amountCents).toBe(preview.value.plan.entries[0].amountCents);
    });
  });

  it("double submit with the same request id creates one charge", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const requestId = randomUUID();
      const first = await addCoverageCommand(tx, broker, policyId, requestId, LIQUOR);
      const second = await addCoverageCommand(tx, broker, policyId, requestId, LIQUOR);
      expect(first).toMatchObject({ ok: true, value: { alreadyAdded: false } });
      expect(second).toMatchObject({ ok: true, value: { alreadyAdded: true } });
      expect(first.ok && second.ok && second.value.chargeId === first.value.chargeId).toBe(true);
      const { lines, entries, events } = await rows(tx, policyId);
      expect(lines).toHaveLength(1);
      expect(entries.filter((e) => e.coverageLineId === requestId)).toHaveLength(1);
      expect(events.filter((e) => e.type === "COVERAGE_ADDED")).toHaveLength(1);
    });
  });

  it("rejects a request id already used on a different policy", async () => {
    await rolledBack(async (tx) => {
      const a = await setup(tx);
      const b = await setup(tx);
      const requestId = randomUUID();
      expect((await addCoverageCommand(tx, a.broker, a.policyId, requestId, LIQUOR)).ok).toBe(true);
      const r = await addCoverageCommand(tx, b.broker, b.policyId, requestId, LIQUOR);
      expect(r).toMatchObject({ ok: false, code: "REQUEST_ID_CONFLICT" });
      expect((await rows(tx, b.policyId)).lines).toHaveLength(0);
    });
  });

  it("rejects a duplicate name (trimmed, any case) with a new request id; the DB index backs it", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      await addCoverageCommand(tx, broker, policyId, randomUUID(), LIQUOR);
      const r = await addCoverageCommand(tx, broker, policyId, randomUUID(), { ...LIQUOR, name: "  LIQUOR liability " });
      expect(r).toMatchObject({ ok: false, code: "DUPLICATE_COVERAGE_NAME", field: "name" });
      const [line] = (await rows(tx, policyId)).lines;
      await expectRejected(
        tx,
        sql`INSERT INTO coverage_lines (policy_id, event_id, name, limit_cents, rate_bps, premium_cents)
            VALUES (${policyId}, ${line!.eventId}, ${" liquor LIABILITY"}, 7300000, 100, 73000)`,
        /coverage_lines_policy_name_unique/,
      );
    });
  });

  it.each([
    ["the term end (excluded)", "2027-01-01"],
    ["before the term start", "2025-12-31"],
  ])("rejects an effective date on %s and writes nothing", async (_l, effectiveDate) => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const r = await addCoverageCommand(tx, broker, policyId, randomUUID(), { ...LIQUOR, effectiveDate });
      expect(r).toMatchObject({ ok: false, code: "EFFECTIVE_DATE_OUTSIDE_TERM", field: "effectiveDate" });
      const after = await rows(tx, policyId);
      expect(after.lines).toHaveLength(0);
      expect(after.entries).toHaveLength(1);
      expect(after.events).toHaveLength(1);
    });
  });

  it("term start charges the full premium and the last day charges one day", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const full = await addCoverageCommand(tx, broker, policyId, randomUUID(), { ...LIQUOR, name: "A", effectiveDate: "2026-01-01" });
      const last = await addCoverageCommand(tx, broker, policyId, randomUUID(), { ...LIQUOR, name: "B", effectiveDate: "2026-12-31" });
      const { entries } = await rows(tx, policyId);
      expect(full.ok && entries.find((e) => e.id === full.value.chargeId)).toMatchObject({ amountCents: 73_000, daysInEffect: 365 });
      expect(last.ok && entries.find((e) => e.id === last.value.chargeId)).toMatchObject({ amountCents: 200, daysInEffect: 1 });
    });
  });

  it("another broker's policy is not found", async () => {
    await rolledBack(async (tx) => {
      const { policyId } = await setup(tx);
      const other = await insertBrokerWithCustomer(tx);
      const r = await addCoverageCommand(tx, { brokerId: other.brokerId, clerkUserId: "user_other" }, policyId, randomUUID(), LIQUOR);
      expect(r).toMatchObject({ ok: false, code: "POLICY_NOT_FOUND" });
    });
  });

  it("applies unapplied cash FIFO to the new charge", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      // $1,000 paid against the $730 policy charge: $270 stays on account.
      const tag = randomUUID().slice(0, 8);
      const paid = await recordStripePaymentCommand(tx, {
        eventId: `evt_test_${tag}`,
        eventType: "checkout.session.completed",
        created: 1_763_000_000,
        livemode: false,
        sessionId: `cs_test_${tag}`,
        paymentIntentId: `pi_test_${tag}`,
        policyId,
        currency: "usd",
        amountTotal: 100_000,
      });
      expect(paid.outcome).toBe("recorded");
      const r = await addCoverageCommand(tx, broker, policyId, randomUUID(), LIQUOR);
      if (!r.ok) throw new Error(r.code);
      const { allocations, events } = await rows(tx, policyId);
      const mine = allocations.filter((a) => a.chargeId === r.value.chargeId);
      expect(mine).toEqual([
        expect.objectContaining({ amountCents: 27_000, sourceEntryId: r.value.chargeId, eventId: events.at(-1)!.id }),
      ]);
    });
  });

  it("the DB rejects a CHARGE whose amount does not match its stored days", async () => {
    await rolledBack(async (tx) => {
      const { policyId } = await setup(tx);
      const [ev] = (await rows(tx, policyId)).events;
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, effective_date, premium_cents, days_in_effect, days_in_term)
            VALUES (${policyId}, ${ev!.id}, 'CHARGE', '2026-11-13', 9, 61201, '2026-03-01', 73000, 306, 365)`,
        /ledger_entries_charge_prorated_round_half_up/,
      );
      await expectRejected(
        tx,
        sql`INSERT INTO ledger_entries (policy_id, event_id, type, date, seq, amount_cents, effective_date, premium_cents, days_in_effect, days_in_term)
            VALUES (${policyId}, ${ev!.id}, 'CHARGE', '2026-11-13', 9, 0, '2026-03-01', 73000, 0, 365)`,
        /ledger_entries_days_shape/,
      );
    });
  });

  it("append-only triggers still block UPDATE and DELETE on the new rows", async () => {
    await rolledBack(async (tx) => {
      const { broker, policyId } = await setup(tx);
      const r = await addCoverageCommand(tx, broker, policyId, randomUUID(), LIQUOR);
      if (!r.ok) throw new Error(r.code);
      const { events } = await rows(tx, policyId);
      const eventId = events.at(-1)!.id;
      await expectRejected(tx, sql`UPDATE ledger_entries SET days_in_effect = 305 WHERE id = ${r.value.chargeId}`, /append-only: UPDATE on ledger_entries/);
      await expectRejected(tx, sql`DELETE FROM ledger_entries WHERE id = ${r.value.chargeId}`, /append-only: DELETE on ledger_entries/);
      await expectRejected(tx, sql`UPDATE coverage_lines SET name = 'X' WHERE id = ${r.value.coverageLineId}`, /append-only: UPDATE on coverage_lines/);
      await expectRejected(tx, sql`DELETE FROM coverage_lines WHERE id = ${r.value.coverageLineId}`, /append-only: DELETE on coverage_lines/);
      await expectRejected(tx, sql`UPDATE policy_events SET payload = '{}' WHERE id = ${eventId}`, /append-only: UPDATE on policy_events/);
      await expectRejected(tx, sql`DELETE FROM policy_events WHERE id = ${eventId}`, /append-only: DELETE on policy_events/);
    });
  });
});
