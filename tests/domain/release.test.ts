import { describe, expect, it } from "vitest";
import { chargeNetOpen, DomainError, planAllocationRelease, type LedgerState } from "@/lib/domain";
import { alloc, charge, payment, paymentEntry } from "./fixtures";

const c1 = charge({ id: "c1", amountCents: 61_200 });

function stateWith(paid: number[]): LedgerState {
  const payments = paid.map((amount, i) => payment(`p${i + 1}`, amount, `2026-03-0${i + 1}`, i + 1));
  return {
    entries: [c1, ...payments.map((p, i) => paymentEntry(p, i + 2))],
    allocations: payments.map((p) => alloc(p.id, "c1", p.amountCents)),
    payments,
  };
}

describe("planAllocationRelease: a credit reduces unpaid first", () => {
  it("credit on an unpaid charge releases nothing", () => {
    const r = planAllocationRelease({ ...stateWith([]), chargeId: "c1", creditCents: 20_000, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([]);
    expect(r.releasedCents).toBe(0);
    expect(r.unpaidBeforeCents).toBe(61_200);
  });

  it("credit on a partly paid charge releases only credit minus unpaid", () => {
    // paid 40,000, unpaid 21,200, credit 30,000 -> release 8,800
    const r = planAllocationRelease({ ...stateWith([40_000]), chargeId: "c1", creditCents: 30_000, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([{ paymentId: "p1", chargeId: "c1", amountCents: -8_800, sourceEntryId: "cr1" }]);
  });

  it("credit smaller than the unpaid part releases nothing", () => {
    const r = planAllocationRelease({ ...stateWith([40_000]), chargeId: "c1", creditCents: 21_200, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([]);
  });

  it("credit on a fully paid charge releases the whole credit, newest payment first", () => {
    const r = planAllocationRelease({ ...stateWith([30_000, 31_200]), chargeId: "c1", creditCents: 40_000, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([
      { paymentId: "p2", chargeId: "c1", amountCents: -31_200, sourceEntryId: "cr1" },
      { paymentId: "p1", chargeId: "c1", amountCents: -8_800, sourceEntryId: "cr1" },
    ]);
    expect(r.releasedCents).toBe(40_000);
  });

  it("newest-first ties break on seq when dates match", () => {
    const pa = payment("pa", 30_000, "2026-03-05", 7);
    const pb = payment("pb", 31_200, "2026-03-05", 3);
    const state: LedgerState = {
      entries: [c1],
      allocations: [alloc("pa", "c1", 30_000), alloc("pb", "c1", 31_200)],
      payments: [pa, pb],
    };
    const r = planAllocationRelease({ ...state, chargeId: "c1", creditCents: 1_000, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([{ paymentId: "pa", chargeId: "c1", amountCents: -1_000, sourceEntryId: "cr1" }]);
  });

  it("counts earlier release rows when finding what a payment still holds", () => {
    const state = stateWith([30_000, 31_200]);
    const withRelease = { ...state, allocations: [...state.allocations, alloc("p2", "c1", -31_200, "x")] };
    // Net: p1 30,000, p2 0. Charge net open 61,200, unpaid 31,200; credit 40,000 -> release 8,800 from p1.
    const r = planAllocationRelease({ ...withRelease, chargeId: "c1", creditCents: 40_000, sourceEntryId: "cr1" });
    expect(r.releases).toEqual([{ paymentId: "p1", chargeId: "c1", amountCents: -8_800, sourceEntryId: "cr1" }]);
  });

  it("throws when asked to credit more than the charge's net amount", () => {
    expect(() =>
      planAllocationRelease({ ...stateWith([61_200]), chargeId: "c1", creditCents: 61_201, sourceEntryId: "cr1" }),
    ).toThrow(DomainError);
    const credited = { ...stateWith([]), entries: [c1, { id: "cr0", type: "CREDIT" as const, date: "2026-06-01", seq: 9, amountCents: -1_200, chargeId: "c1", effectiveDate: "2026-06-01" }] };
    expect(chargeNetOpen(c1, credited.entries)).toBe(60_000);
    expect(() => planAllocationRelease({ ...credited, chargeId: "c1", creditCents: 60_001, sourceEntryId: "cr1" })).toThrow(DomainError);
  });

  it.each([0, -5, 1.5])("throws on a non-positive or non-integer credit %s", (credit) => {
    expect(() => planAllocationRelease({ ...stateWith([]), chargeId: "c1", creditCents: credit, sourceEntryId: "cr1" })).toThrow(DomainError);
  });
});
