// Stripe env validation. Errors name the variable, never its value. Test mode only.

/** Secret (sk_test_) or restricted (rk_test_) test key for API calls. Live keys are refused. */
export function stripeSecretKey(): string {
  const v = process.env.STRIPE_SECRET_KEY;
  if (!v) throw new Error("STRIPE_SECRET_KEY is not set");
  if (/^(sk|rk)_live_/.test(v)) throw new Error("STRIPE_SECRET_KEY is a live key; only test-mode keys are allowed");
  if (!/^(sk|rk)_test_/.test(v)) throw new Error("STRIPE_SECRET_KEY is not a Stripe test secret key");
  return v;
}

/** Webhook signing secret (whsec_). The webhook needs only this, not the API key. */
export function stripeWebhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!v.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET is not a Stripe webhook signing secret");
  return v;
}
