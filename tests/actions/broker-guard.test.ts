// Every function exported by actions/broker.ts must reject a linked policyholder, a
// signed-out session and an unlinked session, before any transaction is opened.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const withTx = vi.fn();
vi.mock("@/lib/db/with-tx", () => ({ withTx }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const actions = await import("@/actions/broker");
const { AuthError } = await import("@/lib/auth/actor");

const exported = Object.entries(actions).filter(([, v]) => typeof v === "function") as [
  string,
  (prev: unknown, formData: FormData) => Promise<unknown>,
][];

function validForm(): FormData {
  // Valid for both actions, so a rejection can only come from the auth check.
  const fd = new FormData();
  const fields: Record<string, string> = {
    customerId: "00000000-0000-4000-8000-000000000002",
    termStart: "2026-01-01",
    transactionDate: "2026-01-01",
    limit: "1,000,000",
    rateBps: "100",
    legalName: "Acme Ltd.",
    contactName: "Sam Lee",
    email: "sam@example.com",
    phone: "+1 416 555 0100",
    addressLine1: "1 Main St",
    city: "Toronto",
    region: "ON",
    postalCode: "M5H 1A1",
    country: "CA",
    businessDescription: "Roofing",
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("actions/broker.ts guard", () => {
  beforeEach(() => {
    withTx.mockReset();
  });

  it("exports the broker actions (and nothing is skipped)", () => {
    expect(exported.map(([name]) => name).sort()).toEqual(["createCustomer", "issuePolicy"]);
  });

  describe.each([
    ["linked policyholder", "linkedPolicyholder", "WRONG_ROLE"],
    ["signed-out session", "signedOut", "SIGNED_OUT"],
    ["unlinked broker session", "unlinkedBroker", "NOT_LINKED"],
    ["session with no role", "noRole", "WRONG_ROLE"],
  ])("%s", (_label, key, code) => {
    it.each(exported)("%s rejects and never calls withTx", async (_name, action) => {
      state.session = sessions[key]!;
      const err = await action({}, validForm()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AuthError);
      expect((err as { code: string }).code).toBe(code);
      expect(withTx).not.toHaveBeenCalled();
    });
  });
});
