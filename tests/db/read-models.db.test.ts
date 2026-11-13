// Read models are scoped by the actor's id. Run against a Tx so rolled-back rows are visible.
import { describe, expect, it } from "vitest";
import { issuePolicyCommand } from "@/lib/services/issue-policy";
import {
  getCustomerForBroker,
  getPolicyForBroker,
  listCustomersForBroker,
  listPoliciesForBroker,
  listPoliciesForCustomer,
  type Reader,
} from "@/lib/services/read-models";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

describe("read models", () => {
  it("never show one broker's or customer's data to another", async () => {
    await rolledBack(async (tx) => {
      const r = tx as unknown as Reader;
      const a = await insertBrokerWithCustomer(tx);
      const b = await insertBrokerWithCustomer(tx);
      const issue = (brokerId: string, customerId: string) =>
        issuePolicyCommand(tx, { brokerId, clerkUserId: "user_test" }, {
          customerId,
          termStart: "2026-01-01",
          transactionDate: "2026-01-01",
          limitCents: 100_000_000,
          rateBps: 100,
        });
      const pa = await issue(a.brokerId, a.customerId);
      const pb = await issue(b.brokerId, b.customerId);
      if (!pa.ok || !pb.ok) throw new Error("issue failed");

      expect((await listCustomersForBroker(a.brokerId, r)).map((c) => c.id)).toEqual([a.customerId]);
      expect((await listPoliciesForBroker(a.brokerId, r)).map((p) => p.id)).toEqual([pa.value.policyId]);
      expect((await listPoliciesForCustomer(b.customerId, r)).map((p) => p.id)).toEqual([pb.value.policyId]);

      expect(await getCustomerForBroker(a.brokerId, b.customerId, r)).toBeNull();
      expect(await getPolicyForBroker(a.brokerId, pb.value.policyId, r)).toBeNull();

      const detail = await getPolicyForBroker(a.brokerId, pa.value.policyId, r);
      expect(detail?.policy).toMatchObject({ id: pa.value.policyId, premiumCents: 1_000_000, status: "active" });
      expect(detail?.events.map((e) => e.type)).toEqual(["POLICY_ISSUED"]);
      expect(detail?.entries).toEqual([
        expect.objectContaining({ type: "CHARGE", seq: 1, amountCents: 1_000_000, effectiveDate: "2026-01-01" }),
      ]);
    });
  });
});
