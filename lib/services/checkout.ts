// Create a Stripe Checkout session for the signed-in policyholder's balance due (step 7).
// The amount is read from the ledger here, server side, scoped by the session's customer
// id; nothing from the client sets it. Creating a session writes nothing to our database.
import type Stripe from "stripe";
import type { PolicyholderActor } from "@/lib/auth/actor";
import { PAYMENT_CURRENCY } from "@/lib/stripe/currency";
import { isUuid } from "./inputs";
import type { ServiceResult } from "./result";
import type { PolicyStatement } from "./statement-view";

export type CheckoutDeps = {
  loadStatement: (customerId: string, policyId: string) => Promise<PolicyStatement | null>;
  createSession: (params: Stripe.Checkout.SessionCreateParams) => Promise<{ id: string; url: string | null }>;
};

/** Stripe's minimum Checkout expiry is 30 minutes; one minute of margin for clock skew. */
export const CHECKOUT_EXPIRY_SECONDS = 31 * 60;

export async function createCheckoutForPolicyholder(
  actor: PolicyholderActor,
  policyId: string,
  origin: string,
  deps: CheckoutDeps,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ServiceResult<{ sessionId: string; url: string; amountCents: number }>> {
  if (!isUuid(policyId)) return { ok: false, code: "POLICY_NOT_FOUND", message: "Policy not found." };
  const statement = await deps.loadStatement(actor.customerId, policyId);
  if (!statement) return { ok: false, code: "POLICY_NOT_FOUND", message: "Policy not found." };
  const { balance, policy } = statement;
  if (balance.kind !== "due" || balance.cents <= 0) {
    return { ok: false, code: "NOTHING_DUE", message: "There is no balance due on this policy." };
  }

  const metadata = { policyId: policy.id, customerId: actor.customerId };
  const base = `${origin}/portal/policies/${policy.id}/payment`;
  const session = await deps.createSession({
    mode: "payment",
    // Card only: async methods complete "unpaid" and are not handled in this step.
    allowed_payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: PAYMENT_CURRENCY,
          unit_amount: balance.cents,
          product_data: { name: `Policy ${policy.policyNumber} balance due` },
        },
      },
    ],
    client_reference_id: policy.id,
    metadata,
    payment_intent_data: { metadata, description: `Policy ${policy.policyNumber} balance due` },
    expires_at: nowSeconds + CHECKOUT_EXPIRY_SECONDS,
    success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/cancelled`,
  });
  if (!session.url) return { ok: false, code: "NO_CHECKOUT_URL", message: "Stripe did not return a payment page." };
  return { ok: true, value: { sessionId: session.id, url: session.url, amountCents: balance.cents } };
}
