// Signed Stripe webhook payloads for tests. Signing is local (HMAC); no network, no API key.
import Stripe from "stripe";

export const WEBHOOK_SECRET = "whsec_test_fixture_secret";

type SessionOverrides = Partial<{
  id: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  metadata: Record<string, string>;
}>;

export function checkoutEvent(
  opts: { id?: string; type?: string; livemode?: boolean; created?: number; session?: SessionOverrides } = {},
) {
  const session = {
    id: "cs_test_1",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    status: "complete",
    amount_total: 73000,
    currency: "usd",
    payment_intent: "pi_test_1",
    metadata: { policyId: "00000000-0000-4000-8000-0000000000a1", customerId: "c" },
    ...opts.session,
  };
  return {
    id: opts.id ?? "evt_test_1",
    object: "event",
    api_version: "2026-10-28.endive",
    created: opts.created ?? 1794441600, // 2026-11-12T00:00:00Z = 2026-11-11 in Toronto
    livemode: opts.livemode ?? false,
    type: opts.type ?? "checkout.session.completed",
    data: { object: session },
  };
}

export function signed(payload: unknown, secret = WEBHOOK_SECRET): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) };
}
