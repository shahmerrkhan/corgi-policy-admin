// The issuePolicy action passes exactly the parsed input (and the session's broker) to
// issuePolicyCommand inside withTx. The command itself is covered by the db test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROKER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const fakeTx = { fake: "tx" };
const withTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));
vi.mock("@/lib/db/with-tx", () => ({ withTx }));
const issuePolicyCommand = vi.fn();
vi.mock("@/lib/services/issue-policy", () => ({ issuePolicyCommand }));
const createCustomerCommand = vi.fn();
vi.mock("@/lib/services/customers", () => ({ createCustomerCommand }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect }));

const { issuePolicy, createCustomer } = await import("@/actions/broker");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const POLICY_ID = "00000000-0000-4000-8000-0000000000a1";

describe("issuePolicy action", () => {
  beforeEach(() => {
    state.session = sessions.linkedBroker!;
    withTx.mockClear();
    issuePolicyCommand.mockReset();
    redirect.mockReset();
  });

  it("passes the parsed input and the session broker to issuePolicyCommand", async () => {
    issuePolicyCommand.mockResolvedValue({ ok: true, value: { policyId: POLICY_ID } });
    await issuePolicy(
      {},
      form({ customerId: CUSTOMER_ID, termStart: "2026-03-01", transactionDate: "2026-02-20", limit: "$73,000.50", rateBps: "125" }),
    );
    expect(withTx).toHaveBeenCalledTimes(1);
    expect(issuePolicyCommand).toHaveBeenCalledTimes(1);
    expect(issuePolicyCommand).toHaveBeenCalledWith(
      fakeTx,
      { role: "broker", clerkUserId: "user_broker", brokerId: BROKER_ROW_ID },
      { customerId: CUSTOMER_ID, termStart: "2026-03-01", transactionDate: "2026-02-20", limitCents: 7_300_050, rateBps: 125 },
    );
    expect(redirect).toHaveBeenCalledWith(`/broker/policies/${POLICY_ID}`);
  });

  it("returns field errors and never opens a transaction for bad input", async () => {
    const r = await issuePolicy({}, form({ customerId: CUSTOMER_ID, termStart: "2028-02-29", transactionDate: "2028-01-01", limit: "1", rateBps: "0" }));
    expect(r.errors).toMatchObject({ termStart: expect.stringContaining("Feb 29"), limit: expect.any(String), rateBps: expect.any(String) });
    expect(withTx).not.toHaveBeenCalled();
  });

  it("shows a business rejection from the command", async () => {
    issuePolicyCommand.mockResolvedValue({ ok: false, code: "CUSTOMER_NOT_FOUND", message: "Customer not found." });
    const r = await issuePolicy(
      {},
      form({ customerId: CUSTOMER_ID, termStart: "2026-03-01", transactionDate: "2026-02-20", limit: "1000", rateBps: "1" }),
    );
    expect(r).toEqual({ message: "Customer not found." });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("createCustomer action", () => {
  beforeEach(() => {
    state.session = sessions.linkedBroker!;
    createCustomerCommand.mockReset();
    redirect.mockReset();
  });

  it("creates for the session broker and redirects to the issue form", async () => {
    createCustomerCommand.mockResolvedValue({ ok: true, value: { customerId: CUSTOMER_ID } });
    await createCustomer(
      {},
      form({
        legalName: "Acme",
        contactName: "Sam",
        email: "sam@example.com",
        phone: "4165550100",
        addressLine1: "1 Main",
        city: "Toronto",
        region: "ON",
        postalCode: "M5H 1A1",
        businessDescription: "Roofing",
        brokerId: "00000000-0000-4000-8000-00000000dead",
      }),
    );
    const [, broker, input] = createCustomerCommand.mock.calls[0]!;
    expect(broker).toMatchObject({ brokerId: BROKER_ROW_ID });
    expect(input).not.toHaveProperty("brokerId");
    expect(redirect).toHaveBeenCalledWith(`/broker/policies/new?customerId=${CUSTOMER_ID}`);
  });

  it("keeps the typed values on a validation error", async () => {
    const r = await createCustomer({}, form({ legalName: "Acme", email: "bad" }));
    expect(r.values).toMatchObject({ legalName: "Acme", email: "bad" });
    expect(r.errors?.email).toBeDefined();
    expect(createCustomerCommand).not.toHaveBeenCalled();
  });
});
