// Stripe webhook handling, separate from the route so it can be tested without Next,
// Stripe's API or the database. Status codes: 400 only for a missing or bad signature,
// 500 only when recording throws (the transaction rolled back, so Stripe retries),
// 200 for everything else, including events we deliberately skip.
import Stripe from "stripe";

/** The fields of a paid checkout.session.completed event that the command uses. */
export type CheckoutCompleted = {
  eventId: string;
  eventType: string;
  livemode: boolean;
  /** Unix seconds: when Stripe created the event. */
  created: number;
  sessionId: string;
  paymentIntentId: string | null;
  /** What Stripe actually collected, in the smallest currency unit. */
  amountTotal: number | null;
  currency: string | null;
  /** metadata.policyId as sent at checkout creation; unvalidated. */
  policyId: string | null;
};

export type RecordOutcome =
  | { outcome: "recorded"; paymentId: string; /** The PAYMENT_RECORDED event id. */ eventId: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "duplicate" };

export type WebhookDeps = {
  webhookSecret: () => string;
  record: (input: CheckoutCompleted) => Promise<RecordOutcome>;
  log: (line: string) => void;
  /** Runs after a committed "recorded" outcome (the payment email). Can never change the response. */
  afterRecorded?: (result: { paymentId: string; eventId: string }) => Promise<unknown>;
};

export type WebhookResponse = { status: 200 | 400 | 500; body: { received: boolean; outcome?: string } };

export function checkoutCompletedFrom(event: Stripe.Event, session: Stripe.Checkout.Session): CheckoutCompleted {
  const pi = session.payment_intent;
  return {
    eventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    created: event.created,
    sessionId: session.id,
    paymentIntentId: typeof pi === "string" ? pi : (pi?.id ?? null),
    amountTotal: session.amount_total,
    currency: session.currency,
    policyId: session.metadata?.policyId ?? null,
  };
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  if (!signature) return { status: 400, body: { received: false } };
  // A missing secret is a server problem, not a bad request: let it throw (500, Stripe retries).
  const secret = deps.webhookSecret();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    deps.log("stripe webhook: signature verification failed");
    return { status: 400, body: { received: false } };
  }

  if (event.type !== "checkout.session.completed") {
    return { status: 200, body: { received: true, outcome: "skipped" } };
  }
  const session = event.data.object;
  if (session.payment_status !== "paid") {
    deps.log(`stripe webhook ${event.id}: session not paid, skipped`);
    return { status: 200, body: { received: true, outcome: "skipped" } };
  }

  let result: RecordOutcome;
  try {
    result = await deps.record(checkoutCompletedFrom(event, session));
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    deps.log(`stripe webhook ${event.id}: recording failed (${name}), rolled back`);
    return { status: 500, body: { received: false } };
  }
  deps.log(`stripe webhook ${event.id}: ${result.outcome}${result.outcome === "ignored" ? ` (${result.reason})` : ""}`);

  // The transaction has committed. The email is best effort: a failure is logged, never a 500.
  if (result.outcome === "recorded" && deps.afterRecorded) {
    try {
      await deps.afterRecorded({ paymentId: result.paymentId, eventId: result.eventId });
    } catch (err) {
      deps.log(`stripe webhook ${event.id}: after-commit step failed (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return { status: 200, body: { received: true, outcome: result.outcome } };
}
