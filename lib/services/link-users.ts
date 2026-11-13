// Links the two Clerk demo users to the seeded broker and customer rows by id (never by
// email). Idempotent: re-linking the same user is a no-op; a different user is refused.
import { eq } from "drizzle-orm";
import { brokers, customers } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";

export const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]+$/;

export type LinkOutcome = "linked" | "already linked";

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

export type LinkTargets = {
  brokerRowId: string;
  customerRowId: string;
  brokerClerkId: string;
  policyholderClerkId: string;
};

export function validateClerkIds(brokerClerkId: string, policyholderClerkId: string): void {
  if (!CLERK_USER_ID_RE.test(brokerClerkId)) throw new LinkError("broker id must look like user_...");
  if (!CLERK_USER_ID_RE.test(policyholderClerkId)) throw new LinkError("policyholder id must look like user_...");
  if (brokerClerkId === policyholderClerkId) throw new LinkError("broker and policyholder must be different Clerk users");
}

export async function linkClerkUsers(tx: Tx, t: LinkTargets): Promise<{ broker: LinkOutcome; policyholder: LinkOutcome }> {
  validateClerkIds(t.brokerClerkId, t.policyholderClerkId);

  // A Clerk user may be linked on one side only.
  const brokerAsCustomer = await tx.select({ id: customers.id }).from(customers).where(eq(customers.clerkUserId, t.brokerClerkId));
  if (brokerAsCustomer.length > 0) throw new LinkError("the broker's Clerk user is already linked to a customer");
  const holderAsBroker = await tx.select({ id: brokers.id }).from(brokers).where(eq(brokers.clerkUserId, t.policyholderClerkId));
  if (holderAsBroker.length > 0) throw new LinkError("the policyholder's Clerk user is already linked to a broker");

  const [b] = await tx.select({ clerkUserId: brokers.clerkUserId }).from(brokers).where(eq(brokers.id, t.brokerRowId)).for("update");
  if (!b) throw new LinkError("seeded broker not found; run npm run db:seed first");
  const [c] = await tx
    .select({ clerkUserId: customers.clerkUserId })
    .from(customers)
    .where(eq(customers.id, t.customerRowId))
    .for("update");
  if (!c) throw new LinkError("seeded customer not found; run npm run db:seed first");

  if (b.clerkUserId && b.clerkUserId !== t.brokerClerkId) throw new LinkError("the broker is already linked to a different Clerk user");
  if (c.clerkUserId && c.clerkUserId !== t.policyholderClerkId) {
    throw new LinkError("the customer is already linked to a different Clerk user");
  }

  let broker: LinkOutcome = "already linked";
  if (!b.clerkUserId) {
    await tx.update(brokers).set({ clerkUserId: t.brokerClerkId }).where(eq(brokers.id, t.brokerRowId));
    broker = "linked";
  }
  let policyholder: LinkOutcome = "already linked";
  if (!c.clerkUserId) {
    await tx
      .update(customers)
      .set({ clerkUserId: t.policyholderClerkId, updatedAt: new Date() })
      .where(eq(customers.id, t.customerRowId));
    policyholder = "linked";
  }
  return { broker, policyholder };
}
