import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { brokers, customers } from "@/lib/db/schema";
import { LinkError, linkClerkUsers } from "@/lib/services/link-users";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

describe("linkClerkUsers", () => {
  it("links once, is a no-op the second time, and refuses a different user", async () => {
    await rolledBack(async (tx) => {
      const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
      const targets = { brokerRowId: brokerId, customerRowId: customerId, brokerClerkId: "user_linkB", policyholderClerkId: "user_linkP" };

      expect(await linkClerkUsers(tx, targets)).toEqual({ broker: "linked", policyholder: "linked" });
      expect(await linkClerkUsers(tx, targets)).toEqual({ broker: "already linked", policyholder: "already linked" });

      await expect(linkClerkUsers(tx, { ...targets, brokerClerkId: "user_other" })).rejects.toBeInstanceOf(LinkError);
      await expect(linkClerkUsers(tx, { ...targets, policyholderClerkId: "user_other" })).rejects.toBeInstanceOf(LinkError);

      const [b] = await tx.select().from(brokers).where(eq(brokers.id, brokerId));
      const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
      expect(b?.clerkUserId).toBe("user_linkB");
      expect(c?.clerkUserId).toBe("user_linkP");
    });
  });

  it("rejects swapped roles, the same user twice and malformed ids", async () => {
    await rolledBack(async (tx) => {
      const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
      const base = { brokerRowId: brokerId, customerRowId: customerId };
      await expect(linkClerkUsers(tx, { ...base, brokerClerkId: "user_same", policyholderClerkId: "user_same" })).rejects.toThrow(
        /different Clerk users/,
      );
      await expect(linkClerkUsers(tx, { ...base, brokerClerkId: "bob", policyholderClerkId: "user_p" })).rejects.toThrow(/user_/);
      await linkClerkUsers(tx, { ...base, brokerClerkId: "user_b1", policyholderClerkId: "user_p1" });
      const other = await insertBrokerWithCustomer(tx);
      await expect(
        linkClerkUsers(tx, { brokerRowId: other.brokerId, customerRowId: other.customerId, brokerClerkId: "user_p1", policyholderClerkId: "user_x" }),
      ).rejects.toThrow(/already linked to a customer/);
    });
  });

  it("fails clearly when the seeded rows are missing", async () => {
    await rolledBack(async (tx) => {
      await expect(
        linkClerkUsers(tx, {
          brokerRowId: "00000000-0000-4000-8000-00000000ffff",
          customerRowId: "00000000-0000-4000-8000-00000000fffe",
          brokerClerkId: "user_b",
          policyholderClerkId: "user_p",
        }),
      ).rejects.toThrow(/run npm run db:seed/);
    });
  });
});
