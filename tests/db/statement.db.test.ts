// Statement read model against the real database (rolled back). A policyholder can load
// only their own customer's policies, even another customer of the same broker; a broker
// only their own.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customers } from "@/lib/db/schema";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import type { Reader } from "@/lib/services/read-models";
import { getStatementForBroker, getStatementForCustomer } from "@/lib/services/statement";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

describe("statement read model", () => {
  it("never shows another customer's or broker's policy statement", async () => {
    await rolledBack(async (tx) => {
      const r = tx as unknown as Reader;
      const a = await insertBrokerWithCustomer(tx);
      const b = await insertBrokerWithCustomer(tx);
      // A second customer of broker A (same broker, different policyholder).
      const sibling = randomUUID();
      await tx.insert(customers).values({
        id: sibling,
        brokerId: a.brokerId,
        legalName: "Sibling Co",
        contactName: "Test Contact",
        email: `sibling-${sibling.slice(0, 8)}@test.invalid`,
        phone: "+1 000 000 0000",
        addressLine1: "1 Test St",
        city: "Toronto",
        region: "ON",
        postalCode: "M5H 1A1",
        businessDescription: "Test",
      });
      const issue = async (brokerId: string, customerId: string) => {
        const res = await issuePolicyCommand(tx, { brokerId, clerkUserId: "user_test" }, {
          customerId,
          termStart: "2026-01-01",
          transactionDate: "2026-01-01",
          limitCents: 7_300_000,
          rateBps: 100,
        });
        if (!res.ok) throw new Error(`issue failed: ${res.code}`);
        return res.value.policyId;
      };
      const own = await issue(a.brokerId, a.customerId);
      const siblingPolicy = await issue(a.brokerId, sibling);
      const otherBrokerPolicy = await issue(b.brokerId, b.customerId);

      // Policyholder A: only their own policy.
      expect(await getStatementForCustomer(a.customerId, siblingPolicy, r)).toBeNull();
      expect(await getStatementForCustomer(a.customerId, otherBrokerPolicy, r)).toBeNull();
      const mine = await getStatementForCustomer(a.customerId, own, r);
      expect(mine?.policy.id).toBe(own);

      // Broker A: their customers' policies, not broker B's.
      expect(await getStatementForBroker(a.brokerId, otherBrokerPolicy, r)).toBeNull();
      expect((await getStatementForBroker(a.brokerId, siblingPolicy, r))?.policy.id).toBe(siblingPolicy);

      // The issued policy: one $730.00 charge, $730.00 due, one POLICY_ISSUED event linked to it.
      expect(mine?.rows).toEqual([
        expect.objectContaining({
          type: "CHARGE",
          seq: 1,
          amountCents: 73_000,
          balanceCents: 73_000,
          description: "Premium, policy issued",
          reversedBy: null,
        }),
      ]);
      expect(mine?.rows[0]?.calculation).toMatchObject({ matchesStored: true, termDays: 365, daysInEffect: 365 });
      expect(mine?.balance).toEqual({ kind: "due", cents: 73_000 });
      expect(mine?.events).toEqual([
        expect.objectContaining({
          type: "POLICY_ISSUED",
          label: "Policy issued",
          actor: "Broker",
          relatedEntries: [{ id: mine!.rows[0]!.id, seq: 1 }],
          paymentStatus: null,
        }),
      ]);
    });
  });
});
