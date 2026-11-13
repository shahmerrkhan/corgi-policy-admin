// The portal policy page loads statements only through the session's customer id. A
// policy that is not the signed-in customer's (the read model returns null) is a 404,
// and the URL can never choose whose statement is read.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/lib/domain";
import { charge, policy, statementOf } from "../statement-fixtures";
import { CUSTOMER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const getStatementForCustomer = vi.fn();
const getStatementForBroker = vi.fn();
vi.mock("@/lib/services/statement", () => ({ getStatementForCustomer, getStatementForBroker }));
class NotFound extends Error {}
class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFound("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Redirect(to);
  }),
}));

const { default: PortalPolicyPage } = await import("@/app/portal/policies/[policyId]/page");
const { default: BrokerPolicyPage } = await import("@/app/broker/policies/[policyId]/page");

const OTHER_POLICY = "00000000-0000-4000-8000-0000000000f9";
const props = (policyId: string) => ({ params: Promise.resolve({ policyId }), searchParams: Promise.resolve({}) });

describe("portal policy page", () => {
  beforeEach(() => {
    getStatementForCustomer.mockReset();
    getStatementForBroker.mockReset();
  });

  it("404s on another customer's policy, reading only with the session's customer id", async () => {
    state.session = sessions.linkedPolicyholder!;
    getStatementForCustomer.mockResolvedValue(null);
    await expect(PortalPolicyPage(props(OTHER_POLICY))).rejects.toBeInstanceOf(NotFound);
    expect(getStatementForCustomer).toHaveBeenCalledExactlyOnceWith(CUSTOMER_ROW_ID, OTHER_POLICY);
    expect(getStatementForBroker).not.toHaveBeenCalled();
  });

  it("passes a Pay balance form only when the owned policy has a balance due", async () => {
    state.session = sessions.linkedPolicyholder!;
    const owned = (entries: LedgerEntry[]) => statementOf(entries, { policy: { ...policy, id: OTHER_POLICY } });

    getStatementForCustomer.mockResolvedValue(owned([charge()]));
    const due = (await PortalPolicyPage(props(OTHER_POLICY))) as ReactElement<{ actions: ReactElement<{ policyId: string; balanceCents: number }> | null }>;
    expect(due.props.actions?.props).toEqual({ policyId: OTHER_POLICY, balanceCents: 73_000 });

    getStatementForCustomer.mockResolvedValue(
      owned([charge(), { id: "p1", type: "PAYMENT", date: "2026-01-10", seq: 2, amountCents: -73_000, paymentId: "pay-1" }]),
    );
    const paid = (await PortalPolicyPage(props(OTHER_POLICY))) as ReactElement<{ actions: unknown }>;
    expect(paid.props.actions).toBeNull();

    getStatementForCustomer.mockResolvedValue(
      owned([charge(), { id: "p1", type: "PAYMENT", date: "2026-01-10", seq: 2, amountCents: -90_000, paymentId: "pay-1" }]),
    );
    const credit = (await PortalPolicyPage(props(OTHER_POLICY))) as ReactElement<{ actions: unknown }>;
    expect(credit.props.actions).toBeNull();
  });

  it("404s on a malformed id without reading anything", async () => {
    state.session = sessions.linkedPolicyholder!;
    await expect(PortalPolicyPage(props("not-a-uuid"))).rejects.toBeInstanceOf(NotFound);
    expect(getStatementForCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ["broker", "linkedBroker", "/no-access"],
    ["signed-out", "signedOut", "/sign-in"],
  ])("redirects a %s session before reading", async (_label, key, to) => {
    state.session = sessions[key]!;
    await expect(PortalPolicyPage(props(OTHER_POLICY))).rejects.toThrow(to);
    expect(getStatementForCustomer).not.toHaveBeenCalled();
  });

  it("the broker page sends a policyholder to /no-access before reading", async () => {
    state.session = sessions.linkedPolicyholder!;
    await expect(BrokerPolicyPage(props(OTHER_POLICY))).rejects.toThrow("/no-access");
    expect(getStatementForBroker).not.toHaveBeenCalled();
  });
});
