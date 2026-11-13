// issuePolicyCommand against the real database, always rolled back.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { premiumCents } from "@/lib/domain";
import { coverageLines, ledgerEntries, paymentAllocations, payments, policies, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

async function rowsFor(tx: Tx, policyId: string) {
  return {
    policies: await tx.select().from(policies).where(eq(policies.id, policyId)),
    events: await tx.select().from(policyEvents).where(eq(policyEvents.policyId, policyId)),
    entries: await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId)),
    allocations: await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId)),
    coverageLines: await tx.select().from(coverageLines).where(eq(coverageLines.policyId, policyId)),
    payments: await tx.select().from(payments).where(eq(payments.policyId, policyId)),
  };
}

async function policiesOfCustomer(tx: Tx, customerId: string) {
  return tx.select().from(policies).where(eq(policies.customerId, customerId));
}

describe("issuePolicyCommand", () => {
  it.each([
    // [label, termStart, transactionDate, limitCents, rateBps, days]
    ["a 365-day term", "2026-01-01", "2025-12-20", 7_300_000, 100, 365],
    ["a term spanning Feb 29 (366 days), with half-up rounding", "2027-06-15", "2027-06-15", 100_001, 5, 366],
    ["a transaction date after term start", "2026-03-01", "2026-04-10", 123_456_789, 137, 365],
  ])("writes one POLICY_ISSUED event and one CHARGE equal to the domain premium: %s", async (_l, termStart, transactionDate, limitCents, rateBps, days) => {
    await rolledBack(async (tx) => {
      const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
      const r = await issuePolicyCommand(
        tx,
        { brokerId, clerkUserId: "user_testbroker" },
        { customerId, termStart, transactionDate, limitCents, rateBps },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expectedPremium = premiumCents(limitCents, rateBps);
      expect(r.value.premiumCents).toBe(expectedPremium);

      const rows = await rowsFor(tx, r.value.policyId);
      expect(rows.policies).toHaveLength(1);
      const policy = rows.policies[0]!;
      expect(policy).toMatchObject({
        customerId,
        brokerId,
        termStart,
        limitCents,
        rateBps,
        premiumCents: expectedPremium,
        status: "active",
        policyNumber: r.value.policyNumber,
      });
      expect(policy.policyNumber).toMatch(/^CGL-\d{6}$/);

      expect(rows.events).toHaveLength(1);
      expect(rows.events[0]).toMatchObject({
        id: r.value.eventId,
        type: "POLICY_ISSUED",
        transactionDate,
        actorRole: "broker",
        actorUserId: "user_testbroker",
        payload: { customerId, termStart, termEnd: policy.termEnd, limitCents, rateBps, premiumCents: expectedPremium },
      });

      expect(rows.entries).toHaveLength(1);
      expect(rows.entries[0]).toMatchObject({
        id: r.value.chargeId,
        type: "CHARGE",
        eventId: r.value.eventId,
        seq: 1,
        date: transactionDate,
        effectiveDate: termStart,
        amountCents: expectedPremium,
        premiumCents: expectedPremium,
        rebookOf: null,
        coverageLineId: null,
      });

      expect(rows.allocations).toHaveLength(0);
      expect(rows.coverageLines).toHaveLength(0);
      expect(rows.payments).toHaveLength(0);

      // Term length is the actual day count, computed by Postgres (independent of the domain).
      const [span] = await tx
        .select({ days: sql<number>`(${policies.termEnd} - ${policies.termStart})::int` })
        .from(policies)
        .where(eq(policies.id, r.value.policyId));
      expect(span?.days).toBe(days);
    });
  });

  it("rejects a Feb 29 term start and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
      const r = await issuePolicyCommand(
        tx,
        { brokerId, clerkUserId: "user_testbroker" },
        { customerId, termStart: "2028-02-29", transactionDate: "2028-02-01", limitCents: 100_000, rateBps: 1 },
      );
      expect(r).toMatchObject({ ok: false, code: "INVALID_TERM_START" });
      expect(await policiesOfCustomer(tx, customerId)).toHaveLength(0);
    });
  });

  it("rejects another broker's customer and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const mine = await insertBrokerWithCustomer(tx);
      const theirs = await insertBrokerWithCustomer(tx);
      const r = await issuePolicyCommand(
        tx,
        { brokerId: mine.brokerId, clerkUserId: "user_testbroker" },
        { customerId: theirs.customerId, termStart: "2026-01-01", transactionDate: "2026-01-01", limitCents: 100_000, rateBps: 1 },
      );
      expect(r).toMatchObject({ ok: false, code: "CUSTOMER_NOT_FOUND" });
      expect(await policiesOfCustomer(tx, theirs.customerId)).toHaveLength(0);
    });
  });
});
