// Stripe env validation: test-mode keys only, and errors never echo the value.
import { afterEach, describe, expect, it } from "vitest";
import { stripeSecretKey, stripeWebhookSecret } from "@/lib/stripe/env";

const saved = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET };
afterEach(() => {
  process.env.STRIPE_SECRET_KEY = saved.key;
  process.env.STRIPE_WEBHOOK_SECRET = saved.hook;
});

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

describe("stripe env", () => {
  it("accepts secret and restricted test keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(stripeSecretKey()).toBe("sk_test_abc");
    process.env.STRIPE_SECRET_KEY = "rk_test_abc";
    expect(stripeSecretKey()).toBe("rk_test_abc");
  });

  it("refuses missing, live and malformed keys without echoing them", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(message(stripeSecretKey)).toBe("STRIPE_SECRET_KEY is not set");
    for (const v of ["sk_live_SECRETVALUE", "rk_live_SECRETVALUE", "pk_test_SECRETVALUE"]) {
      process.env.STRIPE_SECRET_KEY = v;
      const m = message(stripeSecretKey);
      expect(m).toMatch(/^STRIPE_SECRET_KEY /);
      expect(m).not.toContain("SECRETVALUE");
    }
  });

  it("requires a whsec_ webhook secret without echoing it", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_ok";
    expect(stripeWebhookSecret()).toBe("whsec_ok");
    process.env.STRIPE_WEBHOOK_SECRET = "SECRETVALUE";
    expect(message(stripeWebhookSecret)).not.toContain("SECRETVALUE");
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(message(stripeWebhookSecret)).toBe("STRIPE_WEBHOOK_SECRET is not set");
  });
});
