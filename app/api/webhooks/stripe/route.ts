// Stripe webhook. Public in proxy.ts (Stripe has no session); the signature is the auth.
// The only writer of payments. Raw body for signature verification; never cached.
import { withTx } from "@/lib/db/with-tx";
import { notifyPaymentReceived } from "@/lib/email/notify";
import { recordStripePaymentCommand } from "@/lib/services/record-stripe-payment";
import { handleStripeWebhook } from "@/lib/services/stripe-webhook";
import { stripeWebhookSecret } from "@/lib/stripe/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const result = await handleStripeWebhook(rawBody, req.headers.get("stripe-signature"), {
    webhookSecret: stripeWebhookSecret,
    record: (input) => withTx((tx) => recordStripePaymentCommand(tx, input)),
    // Event id, type and outcome only: never the body, headers or keys.
    log: (line) => console.info(line),
    // After the commit; notifyPaymentReceived never throws and never changes the status.
    afterRecorded: ({ eventId }) => notifyPaymentReceived(eventId),
  });
  return Response.json(result.body, { status: result.status });
}
