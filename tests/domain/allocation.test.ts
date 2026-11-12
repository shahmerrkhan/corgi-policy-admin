import { describe, expect, it } from "vitest";
import { allocateFifo, assertInvariants, planCharge, planPaymentApplication, type LedgerState } from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry, TERM_2026 } from "./fixtures";

describe("allocateFifo", () => {
  it("spreads several payments oldest first across the oldest open charges", () => {
    const c1 = charge({ id: "c1", amountCents: 10_000, date: "2026-01-01", seq: 1 });
    const c2 = charge({ id: "c2", amountCents: 20_000, date: "2026-02-01", seq: 2 });
    const p1 = payment("p1", 15_000, "2026-02-05", 1);
    const p2 = payment("p2", 20_000, "2026-02-06", 2);
    const r = allocateFifo({ entries: [c2, c1], allocations: [], payments: [p2, p1], sourceEntryId: null });
    expect(r.allocations).toEqual([
      alloc("p1", "c1", 10_000),
      alloc("p1", "c2", 5_000),
      alloc("p2", "c2", 15_000),
    ]);
    expect(r.remainingByPayment).toEqual([
      { paymentId: "p1", amountCents: 0 },
      { paymentId: "p2", amountCents: 5_000 },
    ]);
  });

  it("ties on date break on seq", () => {
    const a = charge({ id: "a", amountCents: 1_000, date: "2026-01-01", seq: 5 });
    const b = charge({ id: "b", amountCents: 1_000, date: "2026-01-01", seq: 2 });
    const p = payment("p", 1_000, "2026-01-02", 1);
    expect(allocateFifo({ entries: [a, b], allocations: [], payments: [p], sourceEntryId: null }).allocations).toEqual([
      alloc("p", "b", 1_000),
    ]);
  });

  it("ignores pending and failed payments and reversed charges", () => {
    const c1 = charge({ id: "c1", amountCents: 1_000 });
    const pending = payment("pp", 5_000, "2026-01-02", 1, "pending");
    const failed = payment("pf", 5_000, "2026-01-02", 2, "failed");
    expect(allocateFifo({ entries: [c1], allocations: [], payments: [pending, failed], sourceEntryId: null }).allocations).toEqual([]);

    const rev = { id: "r1", type: "REVERSAL" as const, date: "2026-01-03", seq: 2, amountCents: -1_000, reversesEntryId: "c1" };
    const ok = payment("p", 5_000, "2026-01-04", 3);
    expect(allocateFifo({ entries: [c1, rev], allocations: [], payments: [ok], sourceEntryId: null }).allocations).toEqual([]);
  });

  it("respects credits through chargeNetOpen", () => {
    const c1 = charge({ id: "c1", amountCents: 10_000 });
    const cr = { id: "cr", type: "CREDIT" as const, date: "2026-06-01", seq: 2, amountCents: -4_000, chargeId: "c1", effectiveDate: "2026-06-01" };
    const p = payment("p", 10_000, "2026-06-02", 1);
    const r = allocateFifo({ entries: [c1, cr], allocations: [], payments: [p], sourceEntryId: null });
    expect(r.allocations).toEqual([alloc("p", "c1", 6_000)]);
    expect(r.remainingByPayment).toEqual([{ paymentId: "p", amountCents: 4_000 }]);
  });
});

describe("planPaymentApplication", () => {
  const c1 = charge({ id: "c1", amountCents: 61_200 });
  const base: LedgerState = { entries: [c1], allocations: [], payments: [] };

  it("records a PAYMENT entry and allocates it", () => {
    const p = payment("p1", 61_200, "2026-03-05", 1);
    const r = must(planPaymentApplication({ ...base, payment: p, date: "2026-03-05", newId: idGen("x") }));
    expect(r.entries).toEqual([{ id: "x1", type: "PAYMENT", date: "2026-03-05", seq: 2, amountCents: -61_200, paymentId: "p1" }]);
    expect(r.allocations).toEqual([alloc("p1", "c1", 61_200, "x1")]);
    assertInvariants(apply({ ...base, payments: [p] }, r));
  });

  it.each(["pending", "failed"] as const)("a %s payment returns PAYMENT_NOT_SUCCEEDED", (status) => {
    const p = payment("p1", 61_200, "2026-03-05", 1, status);
    const r = planPaymentApplication({ ...base, payment: p, date: "2026-03-05", newId: idGen() });
    expect(r.ok ? null : r.code).toBe("PAYMENT_NOT_SUCCEEDED");
  });

  it("throws on a payment already recorded", () => {
    const p = payment("p1", 61_200, "2026-03-05", 1);
    const state = { entries: [c1, paymentEntry(p, 2)], allocations: [], payments: [p] };
    expect(() => planPaymentApplication({ ...state, payment: p, date: "2026-03-05", newId: idGen() })).toThrow();
  });
});

describe("planCharge", () => {
  it("prices from the effective date and applies credit on account", () => {
    const p = payment("p1", 100_000, "2026-01-02", 1);
    const state: LedgerState = { entries: [paymentEntry(p, 1)], allocations: [], payments: [p] };
    const r = must(
      planCharge({ ...state, term: TERM_2026, premiumCents: 73_000, effectiveDate: "2026-03-01", coverageLineId: "l1", date: "2026-03-01", policyCancelled: false, newId: idGen() }),
    );
    expect(r.entries[0].amountCents).toBe(61_200);
    expect(r.allocations).toEqual([alloc("p1", "e1", 61_200, "e1")]);
    expect(r.remainingByPayment).toEqual([{ paymentId: "p1", amountCents: 38_800 }]);
  });

  it("rejects an effective date outside the term and cancelled policies", () => {
    const base = { entries: [], allocations: [], payments: [], term: TERM_2026, premiumCents: 73_000, coverageLineId: null, date: "2026-03-01", newId: idGen() };
    const out = planCharge({ ...base, effectiveDate: "2027-01-01", policyCancelled: false });
    expect(out.ok ? null : out.code).toBe("EFFECTIVE_DATE_OUTSIDE_TERM");
    const cancelled = planCharge({ ...base, effectiveDate: "2026-03-01", policyCancelled: true });
    expect(cancelled.ok ? null : cancelled.code).toBe("POLICY_CANCELLED");
  });
});
