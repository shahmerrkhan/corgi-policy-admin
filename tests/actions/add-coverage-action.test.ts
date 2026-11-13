// The addCoverage action passes the parsed input, the session broker, the policy id and the
// request id to addCoverageCommand inside withTx, then lands on the new charge. The command
// itself (including double submit) is covered by the db test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROKER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const fakeTx = { fake: "tx" };
const withTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));
vi.mock("@/lib/db/with-tx", () => ({ withTx }));
const addCoverageCommand = vi.fn();
vi.mock("@/lib/services/add-coverage", () => ({ addCoverageCommand }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect }));

const { addCoverage } = await import("@/actions/broker");

const POLICY_ID = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000b1";
const CHARGE_ID = "00000000-0000-4000-8000-0000000000c1";

function form(over: Record<string, string> = {}): FormData {
  const fields = {
    policyId: POLICY_ID,
    requestId: REQUEST_ID,
    name: "Liquor Liability",
    limit: "$73,000",
    rateBps: "100",
    effectiveDate: "2026-03-01",
    transactionDate: "2026-11-13",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("addCoverage action", () => {
  beforeEach(() => {
    state.session = sessions.linkedBroker!;
    withTx.mockClear();
    addCoverageCommand.mockReset();
    redirect.mockReset();
  });

  it("passes the parsed input and redirects to the new charge", async () => {
    addCoverageCommand.mockResolvedValue({
      ok: true,
      value: { policyId: POLICY_ID, coverageLineId: REQUEST_ID, chargeId: CHARGE_ID, alreadyAdded: false },
    });
    await addCoverage({}, form());
    expect(withTx).toHaveBeenCalledTimes(1);
    expect(addCoverageCommand).toHaveBeenCalledWith(
      fakeTx,
      { role: "broker", clerkUserId: "user_broker", brokerId: BROKER_ROW_ID },
      POLICY_ID,
      REQUEST_ID,
      { name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100, effectiveDate: "2026-03-01", transactionDate: "2026-11-13" },
    );
    expect(redirect).toHaveBeenCalledWith(`/broker/policies/${POLICY_ID}#entry-${CHARGE_ID}`);
  });

  it("lands on the existing charge on a double submit (alreadyAdded)", async () => {
    addCoverageCommand.mockResolvedValue({
      ok: true,
      value: { policyId: POLICY_ID, coverageLineId: REQUEST_ID, chargeId: CHARGE_ID, alreadyAdded: true },
    });
    await addCoverage({}, form());
    expect(redirect).toHaveBeenCalledWith(`/broker/policies/${POLICY_ID}#entry-${CHARGE_ID}`);
  });

  it.each([
    ["policyId", "not-a-uuid"],
    ["requestId", ""],
  ])("refuses a missing or malformed %s without a transaction", async (key, value) => {
    const r = await addCoverage({}, form({ [key]: value }));
    expect(r.message).toMatch(/out of date/);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("returns field errors and never opens a transaction for bad input", async () => {
    const r = await addCoverage({}, form({ name: " ", rateBps: "0" }));
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(["name", "rateBps"]);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("shows a business rejection from the command", async () => {
    addCoverageCommand.mockResolvedValue({ ok: false, code: "DUPLICATE_COVERAGE_NAME", message: "Duplicate.", field: "name" });
    const r = await addCoverage({}, form());
    expect(r).toEqual({ message: "Duplicate." });
    expect(redirect).not.toHaveBeenCalled();
  });
});
