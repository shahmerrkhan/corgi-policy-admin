import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { customers } from "@/lib/db/schema";
import { createCustomerCommand } from "@/lib/services/customers";
import type { CustomerInput } from "@/lib/services/inputs";
import { insertBrokerWithCustomer, rolledBack } from "./helpers";

function input(email: string): CustomerInput {
  return {
    legalName: "Acme Roofing Ltd.",
    contactName: "Sam Lee",
    email,
    phone: "+1 416 555 0100",
    addressLine1: "1 Main St",
    addressLine2: null,
    city: "Toronto",
    region: "ON",
    postalCode: "M5H 1A1",
    country: "CA",
    businessDescription: "Roofing",
  };
}

describe("createCustomerCommand", () => {
  it("writes one customer for the session broker with no Clerk link", async () => {
    await rolledBack(async (tx) => {
      const { brokerId } = await insertBrokerWithCustomer(tx);
      const email = `new-${brokerId.slice(0, 8)}@test.invalid`;
      const r = await createCustomerCommand(tx, { brokerId }, input(email));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const rows = await tx.select().from(customers).where(eq(customers.id, r.value.customerId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ...input(email), brokerId, clerkUserId: null });
    });
  });

  it("returns EMAIL_TAKEN for a duplicate email and the transaction stays usable", async () => {
    await rolledBack(async (tx) => {
      const { brokerId, customerId } = await insertBrokerWithCustomer(tx);
      const [existing] = await tx.select().from(customers).where(eq(customers.id, customerId));
      const r = await createCustomerCommand(tx, { brokerId }, input(existing!.email));
      expect(r).toMatchObject({ ok: false, code: "EMAIL_TAKEN" });
      const after = await tx.select().from(customers).where(eq(customers.email, existing!.email));
      expect(after).toHaveLength(1);
    });
  });
});
