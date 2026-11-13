// The correctCoverageDate action passes the parsed input, the session broker, the policy id,
// the request id and the target line/charge to correctCoverageCommand inside withTx, then
// lands on the new charge. The command (including double submit) is covered by the db test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROKER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "./session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());
const fakeTx = { fake: "tx" };
const withTx = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));
vi.mock("@/lib/db/with-tx", () => ({ withTx }));
const correctCoverageCommand = vi.fn();
vi.mock("@/lib/services/correct-coverage", () => ({ correctCoverageCommand }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect }));

const { correctCoverageDate } = await import("@/actions/broker");

const POLICY_ID = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000b1";
const LINE_ID = "00000000-0000-4000-8000-0000000000c1";
const CHARGE_ID = "00000000-0000-4000-8000-0000000000d1";
const NEW_CHARGE_ID = "00000000-0000-4000-8000-0000000000e1";

function form(over: Record<string, string> = {}): FormData {
  const fields = {
    policyId: POLICY_ID,
    requestId: REQUEST_ID,
    coverageLineId: LINE_ID,
    expectedChargeId: CHARGE_ID,
    newEffectiveDate: "2026-02-22",
    transactionDate: "2026-11-13",
    reason: "Wrong start date",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("correctCoverageDate action", () => {
  beforeEach(() => {
    state.session = sessions.linkedBroker!;
    withTx.mockClear();
    correctCoverageCommand.mockReset();
    redirect.mockReset();
  });

  it("passes the parsed input and redirects to the new charge", async () => {
    correctCoverageCommand.mockResolvedValue({
      ok: true,
      value: { policyId: POLICY_ID, eventId: REQUEST_ID, newChargeId: NEW_CHARGE_ID, alreadyCorrected: false },
    });
    await correctCoverageDate({}, form());
    expect(correctCoverageCommand).toHaveBeenCalledWith(
      fakeTx,
      { role: "broker", clerkUserId: "user_broker", brokerId: BROKER_ROW_ID },
      POLICY_ID,
      REQUEST_ID,
      { coverageLineId: LINE_ID, expectedChargeId: CHARGE_ID },
      { newEffectiveDate: "2026-02-22", transactionDate: "2026-11-13", reason: "Wrong start date" },
    );
    expect(redirect).toHaveBeenCalledWith(`/broker/policies/${POLICY_ID}#entry-${NEW_CHARGE_ID}`);
  });

  it.each(["policyId", "requestId", "coverageLineId", "expectedChargeId"])("refuses a malformed %s without a transaction", async (key) => {
    const r = await correctCoverageDate({}, form({ [key]: "nope" }));
    expect(r.message).toMatch(/out of date/);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("returns field errors and never opens a transaction for bad input", async () => {
    const r = await correctCoverageDate({}, form({ reason: " ", newEffectiveDate: "x" }));
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(["newEffectiveDate", "reason"]);
    expect(withTx).not.toHaveBeenCalled();
  });

  it("a stale review links back to the line's correction form", async () => {
    correctCoverageCommand.mockResolvedValue({ ok: false, code: "CHARGE_ALREADY_REVERSED", message: "Stale." });
    const r = await correctCoverageDate({}, form());
    expect(r).toEqual({ message: "Stale.", restartHref: `/broker/policies/${POLICY_ID}/coverage/${LINE_ID}/correct` });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows any other business rejection", async () => {
    correctCoverageCommand.mockResolvedValue({ ok: false, code: "SAME_EFFECTIVE_DATE", message: "Same date." });
    expect(await correctCoverageDate({}, form())).toEqual({ message: "Same date." });
  });
});
