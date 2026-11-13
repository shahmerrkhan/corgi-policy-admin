// POST /api/webhooks/stripe, end to end through the route with the database mocked:
// signature (400), skipped events (200, no transaction), amount from amount_total, and a
// failing transaction (500 so Stripe retries).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutCompleted, RecordOutcome } from "@/lib/services/stripe-webhook";
import { WEBHOOK_SECRET, checkoutEvent, signed } from "./fixtures";

const withTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ fake: "tx" }));
vi.mock("@/lib/db/with-tx", () => ({ withTx }));
const recordStripePaymentCommand = vi.fn<(tx: unknown, input: CheckoutCompleted) => Promise<RecordOutcome>>(
  async () => ({ outcome: "recorded", paymentId: "pay_1", eventId: "ev_1" }),
);
vi.mock("@/lib/services/record-stripe-payment", () => ({ recordStripePaymentCommand }));
const notifyPaymentReceived = vi.fn<(eventId: string) => Promise<"sent">>(async () => "sent");
vi.mock("@/lib/email/notify", () => ({ notifyPaymentReceived }));

const { POST, runtime, dynamic } = await import("@/app/api/webhooks/stripe/route");

function request(body: string, signature?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", body, headers });
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    withTx.mockClear();
    recordStripePaymentCommand.mockClear();
    notifyPaymentReceived.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("runs on Node and is never cached", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("records a valid signed paid session in one transaction", async () => {
    const { body, signature } = signed(checkoutEvent());
    const res = await POST(request(body, signature));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "recorded" });
    expect(withTx).toHaveBeenCalledTimes(1);
    expect(recordStripePaymentCommand).toHaveBeenCalledTimes(1);
    expect(recordStripePaymentCommand.mock.calls[0]![1]).toEqual({
      eventId: "evt_test_1",
      eventType: "checkout.session.completed",
      livemode: false,
      created: 1794441600,
      sessionId: "cs_test_1",
      paymentIntentId: "pi_test_1",
      amountTotal: 73000,
      currency: "usd",
      policyId: "00000000-0000-4000-8000-0000000000a1",
    });
  });

  it("returns 400 and writes nothing for a bad signature", async () => {
    const { body } = signed(checkoutEvent());
    const forged = signed(checkoutEvent(), "whsec_someone_else").signature;
    const res = await POST(request(body, forged));
    expect(res.status).toBe(400);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("returns 400 and writes nothing for a missing signature or a tampered body", async () => {
    const { body, signature } = signed(checkoutEvent());
    expect((await POST(request(body))).status).toBe(400);
    const tampered = body.replace('"amount_total":73000', '"amount_total":1');
    expect((await POST(request(tampered, signature))).status).toBe(400);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("returns 200 and writes nothing for another event type", async () => {
    for (const type of ["payment_intent.succeeded", "charge.refunded", "checkout.session.expired"]) {
      const { body, signature } = signed(checkoutEvent({ type }));
      const res = await POST(request(body, signature));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, outcome: "skipped" });
    }
    expect(withTx).not.toHaveBeenCalled();
  });

  it("returns 200 and writes nothing for an unpaid session", async () => {
    for (const payment_status of ["unpaid", "no_payment_required"]) {
      const { body, signature } = signed(checkoutEvent({ session: { payment_status } }));
      const res = await POST(request(body, signature));
      expect(res.status).toBe(200);
    }
    expect(withTx).not.toHaveBeenCalled();
  });

  it("takes the amount from Stripe's amount_total, never from metadata", async () => {
    const { body, signature } = signed(
      checkoutEvent({
        session: {
          amount_total: 12345,
          metadata: { policyId: "00000000-0000-4000-8000-0000000000a1", amountCents: "1", amount: "1" },
        },
      }),
    );
    await POST(request(body, signature));
    expect(recordStripePaymentCommand.mock.calls[0]![1].amountTotal).toBe(12345);
  });

  it("returns 500 when the transaction fails, so Stripe retries", async () => {
    withTx.mockRejectedValueOnce(Object.assign(new Error("connection terminated"), { code: "08006" }));
    const { body, signature } = signed(checkoutEvent());
    const res = await POST(request(body, signature));
    expect(res.status).toBe(500);
  });

  it("never logs the body, signature or secret", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { body, signature } = signed(checkoutEvent());
    await POST(request(body, signature));
    await POST(request(body, "t=1,v1=bad"));
    const logged = info.mock.calls.flat().join("\n");
    expect(logged).not.toContain(WEBHOOK_SECRET);
    expect(logged).not.toContain(signature);
    expect(logged).not.toContain("pi_test_1");
    expect(logged).toContain("evt_test_1");
  });

  it("emails once after a recorded payment, with the PAYMENT_RECORDED event id", async () => {
    const { body, signature } = signed(checkoutEvent());
    await POST(request(body, signature));
    expect(notifyPaymentReceived).toHaveBeenCalledExactlyOnceWith("ev_1");
    // The email runs after the transaction returned, never inside it.
    expect(withTx.mock.invocationCallOrder[0]!).toBeLessThan(notifyPaymentReceived.mock.invocationCallOrder[0]!);
  });

  it("does not email for a duplicate delivery, an ignored event or a failed transaction", async () => {
    recordStripePaymentCommand.mockResolvedValueOnce({ outcome: "duplicate" });
    recordStripePaymentCommand.mockResolvedValueOnce({ outcome: "ignored", reason: "LIVE_MODE" });
    const { body, signature } = signed(checkoutEvent());
    await POST(request(body, signature));
    await POST(request(body, signature));
    withTx.mockRejectedValueOnce(new Error("boom"));
    await POST(request(body, signature));
    expect(notifyPaymentReceived).not.toHaveBeenCalled();
  });

  it("still returns 200 when the email step throws", async () => {
    notifyPaymentReceived.mockRejectedValueOnce(new Error("resend down"));
    const { body, signature } = signed(checkoutEvent());
    const res = await POST(request(body, signature));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "recorded" });
  });
});
