import { describe, expect, it } from "vitest";
import {
  allocateFifo,
  assertInvariants,
  cashConservation,
  checkInvariants,
  DomainError,
  planRefund,
  type LedgerState,
} from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry } from "./fixtures";

const c1 = charge({ id: "c1", amountCents: 30_000, date: "2026-01-01", seq: 1 });
const p = payment("p1", 50_000, "2026-01-05", 1);
const valid: LedgerState = {
  entries: [c1, paymentEntry(p, 2)],
  allocations: [alloc("p1", "c1", 30_000)],
  payments: [p],
};

describe("invariants", () => {
  it("a valid ledger has no violations and conserves cash", () => {
    expect(checkInvariants(valid)).toEqual([]);
    expect(cashConservation(valid)).toEqual({ paymentsCents: 50_000, allocatedCents: 30_000, unappliedCents: 20_000, refundedCents: 0 });
  });

  it("refund then re-allocation of the same cash fails the invariant", () => {
    const refunded = apply(valid, must(planRefund({ ...valid, amountCents: 20_000, date: "2026-02-01", newId: idGen("rf") })));
    expect(checkInvariants(refunded)).toEqual([]);

    const c2 = charge({ id: "c2", amountCents: 20_000, date: "2026-02-02", seq: 9 });
    const withCharge = { ...refunded, entries: [...refunded.entries, c2] };
    // FIFO sees no unapplied cash, so it allocates nothing...
    expect(allocateFifo({ ...withCharge, sourceEntryId: null }).allocations).toEqual([]);
    // ...and forcing the refunded cash onto the new charge breaks the payment invariant.
    const forced = { ...withCharge, allocations: [...withCharge.allocations, alloc("p1", "c2", 20_000)] };
    const v = checkInvariants(forced);
    expect(v).toContain("payment p1 allocations + refunds 70000 outside 0..50000");
    expect(v.some((s) => s.startsWith("cash not conserved"))).toBe(true);
    expect(() => assertInvariants(forced)).toThrow(DomainError);
  });

  it("catches a charge holding more than its net amount after a credit", () => {
    const cr = { id: "cr", type: "CREDIT" as const, date: "2026-06-01", seq: 3, amountCents: -10_000, chargeId: "c1", effectiveDate: "2026-06-01" };
    const v = checkInvariants({ ...valid, entries: [...valid.entries, cr] });
    expect(v).toContain("charge c1 net allocations 30000 outside 0..20000");
  });

  it("catches a release bigger than what the payment gave the charge", () => {
    const p2 = payment("p2", 10_000, "2026-01-06", 2);
    const state: LedgerState = {
      entries: [...valid.entries, paymentEntry(p2, 3)],
      allocations: [alloc("p1", "c1", 20_000), alloc("p2", "c1", 10_000), alloc("p2", "c1", -15_000), alloc("p1", "c1", 5_000)],
      payments: [p, p2],
    };
    expect(checkInvariants(state)).toContain("payment|charge p2|c1 net allocation -5000 is negative");
  });

  it("catches an inexact reversal, a double reversal and allocations from a failed payment", () => {
    const bad = { id: "r1", type: "REVERSAL" as const, date: "2026-02-01", seq: 3, amountCents: -29_999, reversesEntryId: "c1" };
    const twice = { ...bad, id: "r2", seq: 4, amountCents: -30_000 };
    const failed = payment("pf", 1_000, "2026-01-07", 3, "failed");
    const v = checkInvariants({
      entries: [...valid.entries, bad, twice],
      allocations: [alloc("pf", "c1", 1_000)],
      payments: [p, failed],
    });
    expect(v).toContain("reversal r1 is -29999, not exactly -30000");
    expect(v).toContain("charge c1 is reversed 2 times");
    expect(v).toContain("allocation from failed payment pf");
  });

  it("requires exactly one PAYMENT entry per succeeded payment", () => {
    expect(checkInvariants({ ...valid, entries: [c1] })).toContain("succeeded payment p1 needs exactly one PAYMENT entry");
  });
});
