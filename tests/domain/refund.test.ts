import { describe, expect, it } from "vitest";
import { assertInvariants, DomainError, planRefund, totalRefundable, type LedgerState } from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry } from "./fixtures";

// Charge 20,000 paid by pA 15,000 + 5,000 of pB 25,000: 20,000 unapplied, all on pB.
const c1 = charge({ id: "c1", amountCents: 20_000 });
const pA = payment("pA", 15_000, "2026-02-01", 1);
const pB = payment("pB", 25_000, "2026-02-10", 2);
const pending = payment("pP", 9_000, "2026-02-11", 3, "pending");
const state: LedgerState = {
  entries: [c1, paymentEntry(pA, 2), paymentEntry(pB, 3)],
  allocations: [alloc("pA", "c1", 15_000), alloc("pB", "c1", 5_000)],
  payments: [pA, pB, pending],
};

describe("planRefund", () => {
  it("only succeeded payments with unapplied cash count", () => {
    expect(totalRefundable(state)).toBe(20_000);
  });

  it("refund of exactly the refundable cash works, newest payment first", () => {
    const r = must(planRefund({ ...state, amountCents: 20_000, date: "2026-03-01", newId: idGen("rf") }));
    expect(r.entries).toEqual([{ id: "rf1", type: "REFUND", date: "2026-03-01", seq: 4, amountCents: 20_000, paymentId: "pB" }]);
    const after = apply(state, r);
    assertInvariants({ ...after, payments: [pA, pB] });
    expect(totalRefundable(after)).toBe(0);
  });

  it("refundable + 1 returns NOT_ENOUGH_REFUNDABLE_CASH", () => {
    const r = planRefund({ ...state, amountCents: 20_001, date: "2026-03-01", newId: idGen() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NOT_ENOUGH_REFUNDABLE_CASH");
      expect(r.details).toEqual({ requestedCents: 20_001, refundableCents: 20_000 });
    }
  });

  it("splits across payments newest first", () => {
    // Release everything so both payments hold cash: pA 15,000, pB 25,000.
    const freed: LedgerState = { ...state, allocations: [...state.allocations, alloc("pA", "c1", -15_000), alloc("pB", "c1", -5_000)] };
    const r = must(planRefund({ ...freed, amountCents: 30_000, date: "2026-03-01", newId: idGen() }));
    expect(r.byPayment).toEqual([
      { paymentId: "pB", amountCents: 25_000 },
      { paymentId: "pA", amountCents: 5_000 },
    ]);
  });

  it.each([0, -100, 10.5])("throws on bad amount %s", (amount) => {
    expect(() => planRefund({ ...state, amountCents: amount, date: "2026-03-01", newId: idGen() })).toThrow(DomainError);
  });
});
