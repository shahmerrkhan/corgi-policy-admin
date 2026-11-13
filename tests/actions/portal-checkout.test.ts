// startCheckout: only the signed-in policyholder who owns the policy can open a Checkout
// session, only for a balance due > 0, and the amount comes from the ledger (the statement
// read model), never from the form. Stripe and the database are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { LedgerEntry } from "@/lib/domain";
import { charge, policy, statementOf } from "../statement-fixtures";
import { CUSTOMER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const getStatementForCustomer = vi.fn();
vi.mock("@/lib/services/statement", () => ({ getStatementForCustomer }));
const create = vi.fn<(params: Stripe.Checkout.SessionCreateParams) => Promise<{ id: string; url: string | null }>>(
  async () => ({ id: "cs_test_new", url: "https://checkout.stripe.com/c/pay/cs_test_new" }),
);
const getStripe = vi.fn(() => ({ checkout: { sessions: { create } } }));
vi.mock("@/lib/stripe/client", () => ({ getStripe }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));
class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirect(to);
  }),
}));

const { startCheckout } = await import("@/actions/portal");

const POLICY = "00000000-0000-4000-8000-0000000000a1";
const owned = (entries: LedgerEntry[] = [charge()]) => statementOf(entries, { policy: { ...policy, id: POLICY } });
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("startCheckout", () => {
  beforeEach(() => {
    getStatementForCustomer.mockReset();
    create.mockClear();
    getStripe.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("creates a USD card session for the ledger balance and redirects to Stripe", async () => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(owned());
    // A forged amount field in the form is ignored.
    await expect(startCheckout({}, form({ policyId: POLICY, amountCents: "1" }))).rejects.toThrow(
      "https://checkout.stripe.com/c/pay/cs_test_new",
    );
    expect(getStatementForCustomer).toHaveBeenCalledExactlyOnceWith(CUSTOMER_ROW_ID, POLICY);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0];
    expect(params.mode).toBe("payment");
    expect(params.allowed_payment_method_types).toEqual(["card"]);
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: { currency: "usd", unit_amount: 73_000, product_data: { name: "Policy CGL-000050 balance due" } },
      },
    ]);
    expect(params.metadata).toEqual({ policyId: POLICY, customerId: CUSTOMER_ROW_ID });
    expect(params.payment_intent_data?.metadata).toEqual({ policyId: POLICY, customerId: CUSTOMER_ROW_ID });
    expect(params.success_url).toBe(
      `http://localhost:3000/portal/policies/${POLICY}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(params.cancel_url).toBe(`http://localhost:3000/portal/policies/${POLICY}/payment/cancelled`);
    expect(params.customer_email).toBeUndefined();
  });

  it("charges the remaining balance after an earlier payment", async () => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(
      owned([charge(), { id: "p1", type: "PAYMENT", date: "2026-01-10", seq: 2, amountCents: -50_000, paymentId: "pay-1" }]),
    );
    await expect(startCheckout({}, form({ policyId: POLICY }))).rejects.toBeInstanceOf(Redirect);
    expect(create.mock.calls[0]![0].line_items?.[0]?.price_data?.unit_amount).toBe(23_000);
  });

  it.each([
    ["broker", "linkedBroker"],
    ["signed-out", "signedOut"],
    ["unlinked", "unlinkedBroker"],
  ])("refuses a %s session before reading or calling Stripe", async (_label, key) => {
    state.session = sessions[key]!;
    await expect(startCheckout({}, form({ policyId: POLICY }))).rejects.toThrow(/Not allowed/);
    expect(getStatementForCustomer).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses another holder's policy without calling Stripe", async () => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(null);
    expect(await startCheckout({}, form({ policyId: POLICY }))).toEqual({ message: "Policy not found." });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a malformed policy id without reading", async () => {
    state.session = sessions.linkedPolicyholder!;
    expect(await startCheckout({}, form({ policyId: "nope" }))).toEqual({ message: "Policy not found." });
    expect(getStatementForCustomer).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["a zero balance", [charge(), { id: "p1", type: "PAYMENT" as const, date: "2026-01-10", seq: 2, amountCents: -73_000, paymentId: "pay-1" }]],
    ["a credit", [charge(), { id: "p1", type: "PAYMENT" as const, date: "2026-01-10", seq: 2, amountCents: -80_000, paymentId: "pay-1" }]],
  ])("refuses %s without calling Stripe", async (_label, entries) => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(owned(entries));
    expect(await startCheckout({}, form({ policyId: POLICY }))).toEqual({
      message: "There is no balance due on this policy.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("shows a retry message when Stripe fails", async () => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(owned());
    create.mockRejectedValueOnce(new Error("api down"));
    expect(await startCheckout({}, form({ policyId: POLICY }))).toEqual({
      message: "Could not start the payment. Try again in a moment.",
    });
  });
});
