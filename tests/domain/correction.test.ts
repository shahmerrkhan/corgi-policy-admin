import { describe, expect, it } from "vitest";
import {
  assertInvariants,
  balanceCents,
  latestInChain,
  planCharge,
  planCorrection,
  planPaymentApplication,
  premiumCents,
  type LedgerState,
} from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry, TERM_2026 } from "./fixtures";

const EMPTY: LedgerState = { entries: [], allocations: [], payments: [] };

function scenarioCharge(newId = idGen()) {
  const P = premiumCents(7_300_000, 100);
  const planned = must(
    planCharge({
      ...EMPTY,
      term: TERM_2026,
      premiumCents: P,
      effectiveDate: "2026-03-01",
      coverageLineId: "line-1",
      date: "2026-03-01",
      policyCancelled: false,
      newId,
    }),
  );
  return { newId, state: apply(EMPTY, planned), original: planned.entries[0] };
}

describe("required scenario: $730 premium, 306 -> 313 days", () => {
  it("original 61,200, reversal -61,200, rebook 62,600, net +1,400, all visible", () => {
    const { newId, state, original } = scenarioCharge();
    expect(original.premiumCents).toBe(73_000);
    expect(original.amountCents).toBe(61_200);

    const c = must(
      planCorrection({
        ...state,
        term: TERM_2026,
        chargeId: original.id,
        newEffectiveDate: "2026-02-22",
        date: "2026-03-22",
        policyCancelled: false,
        newId,
      }),
    );
    expect(c.reversal.amountCents).toBe(-61_200);
    expect(c.reversal.reversesEntryId).toBe(original.id);
    expect(c.rebook.amountCents).toBe(62_600);
    expect(c.rebook.effectiveDate).toBe("2026-02-22");
    expect(c.rebook.rebookOf).toBe(original.id);
    expect(c.netChangeCents).toBe(1_400);

    const after = apply(state, c);
    expect(after.entries.map((e) => [e.type, e.amountCents])).toEqual([
      ["CHARGE", 61_200],
      ["REVERSAL", -61_200],
      ["CHARGE", 62_600],
    ]);
    expect(balanceCents(after.entries)).toBe(62_600);
    expect(c.entries.map((e) => e.type)).toEqual(["REVERSAL", "CHARGE"]);
    assertInvariants(after);
  });

  it("the reversal copies the original amount even if it differs from a recomputation", () => {
    // A stored charge of 61,201 (not what proration gives) is reversed as exactly -61,201.
    const odd = charge({ id: "c1", amountCents: 61_201, premiumCents: 73_000, effectiveDate: "2026-03-01" });
    const c = must(
      planCorrection({
        ...EMPTY,
        entries: [odd],
        term: TERM_2026,
        chargeId: "c1",
        newEffectiveDate: "2026-02-22",
        date: "2026-03-22",
        policyCancelled: false,
        newId: idGen(),
      }),
    );
    expect(c.reversal.amountCents).toBe(-61_201);
    expect(c.rebook.amountCents).toBe(62_600);
  });
});

describe("correction rules", () => {
  const base = () => {
    const { newId, state, original } = scenarioCharge();
    return { newId, state, original, input: { ...state, term: TERM_2026, date: "2026-03-22", policyCancelled: false, newId } };
  };

  it("correcting an already reversed charge returns CHARGE_ALREADY_REVERSED with the latest charge", () => {
    const { state, original, input } = base();
    const first = must(planCorrection({ ...input, chargeId: original.id, newEffectiveDate: "2026-02-22" }));
    const s1 = apply(state, first);
    const second = must(planCorrection({ ...input, ...s1, chargeId: first.rebook.id, newEffectiveDate: "2026-02-15" }));
    const s2 = apply(s1, second);

    const r = planCorrection({ ...input, ...s2, chargeId: original.id, newEffectiveDate: "2026-02-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("CHARGE_ALREADY_REVERSED");
      expect(r.details?.latestChargeId).toBe(second.rebook.id);
    }
    expect(latestInChain(s2.entries, original.id).id).toBe(second.rebook.id);
    expect(second.rebook.rebookOf).toBe(first.rebook.id);
    expect(second.reversal.amountCents).toBe(-62_600);
    assertInvariants(s2);
  });

  it.each([
    ["2027-01-01", "on term_end"],
    ["2025-12-31", "before term_start"],
  ])("rejects a correction date %s (%s)", (date) => {
    const { original, input } = base();
    const r = planCorrection({ ...input, chargeId: original.id, newEffectiveDate: date });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EFFECTIVE_DATE_OUTSIDE_TERM");
  });

  it("accepts the first and last day of the term", () => {
    const { original, input } = base();
    expect(must(planCorrection({ ...input, chargeId: original.id, newEffectiveDate: "2026-01-01" })).rebook.amountCents).toBe(73_000);
    expect(must(planCorrection({ ...input, chargeId: original.id, newEffectiveDate: "2026-12-31" })).rebook.amountCents).toBe(200);
  });

  it("rejects the same date and cancelled policies", () => {
    const { original, input } = base();
    const same = planCorrection({ ...input, chargeId: original.id, newEffectiveDate: "2026-03-01" });
    expect(same.ok ? null : same.code).toBe("SAME_EFFECTIVE_DATE");
    const cancelled = planCorrection({ ...input, policyCancelled: true, chargeId: original.id, newEffectiveDate: "2026-02-22" });
    expect(cancelled.ok ? null : cancelled.code).toBe("POLICY_CANCELLED");
  });
});

describe("paid charge reversed: release newest first, re-allocate oldest first", () => {
  it("two payments on one charge", () => {
    const newId = idGen();
    const c1 = charge({ id: "c1", amountCents: 61_200, premiumCents: 73_000, effectiveDate: "2026-03-01", date: "2026-03-01", seq: 1 });
    const pA = payment("pA", 30_000, "2026-03-05", 1);
    const pB = payment("pB", 31_200, "2026-03-10", 2);
    const state: LedgerState = {
      entries: [c1, paymentEntry(pA, 2), paymentEntry(pB, 3)],
      allocations: [alloc("pA", "c1", 30_000), alloc("pB", "c1", 31_200)],
      payments: [pA, pB],
    };
    assertInvariants(state);

    const c = must(
      planCorrection({ ...state, term: TERM_2026, chargeId: "c1", newEffectiveDate: "2026-02-22", date: "2026-03-22", policyCancelled: false, newId }),
    );
    expect(c.releases).toEqual([
      { paymentId: "pB", chargeId: "c1", amountCents: -31_200, sourceEntryId: c.reversal.id },
      { paymentId: "pA", chargeId: "c1", amountCents: -30_000, sourceEntryId: c.reversal.id },
    ]);
    expect(c.allocations).toEqual([
      { paymentId: "pA", chargeId: c.rebook.id, amountCents: 30_000, sourceEntryId: c.rebook.id },
      { paymentId: "pB", chargeId: c.rebook.id, amountCents: 31_200, sourceEntryId: c.rebook.id },
    ]);
    const after = apply(state, c);
    assertInvariants(after);
    expect(balanceCents(after.entries)).toBe(1_400);
  });

  it("freed cash goes to the oldest open charge first, leftover stays on account", () => {
    const newId = idGen();
    const old = charge({ id: "c0", amountCents: 10_000, date: "2026-01-01", seq: 1 });
    const c1 = charge({ id: "c1", amountCents: 61_200, premiumCents: 73_000, effectiveDate: "2026-03-01", date: "2026-03-01", seq: 2 });
    const pA = payment("pA", 61_200, "2026-03-05", 1);
    const state: LedgerState = {
      entries: [old, c1, paymentEntry(pA, 3)],
      allocations: [alloc("pA", "c1", 61_200)],
      payments: [pA],
    };
    // Correct to later: rebook 2026-04-01 is 275 days = 55,000.
    const c = must(
      planCorrection({ ...state, term: TERM_2026, chargeId: "c1", newEffectiveDate: "2026-04-01", date: "2026-04-02", policyCancelled: false, newId }),
    );
    expect(c.rebook.amountCents).toBe(55_000);
    expect(c.allocations).toEqual([
      { paymentId: "pA", chargeId: "c0", amountCents: 10_000, sourceEntryId: c.rebook.id },
      { paymentId: "pA", chargeId: c.rebook.id, amountCents: 51_200, sourceEntryId: c.rebook.id },
    ]);
    expect(c.remainingByPayment).toEqual([{ paymentId: "pA", amountCents: 0 }]);
    assertInvariants(apply(state, c));
  });

  it("a later payment pays the corrected balance", () => {
    const { newId, state, original } = scenarioCharge();
    const pA = payment("pA", 61_200, "2026-03-05", 1);
    const paid = apply(
      { ...state, payments: [pA] },
      must(planPaymentApplication({ ...state, payments: [pA], payment: pA, date: "2026-03-05", newId })),
    );
    const c = must(
      planCorrection({ ...paid, term: TERM_2026, chargeId: original.id, newEffectiveDate: "2026-02-22", date: "2026-03-22", policyCancelled: false, newId }),
    );
    const after = apply(paid, c);
    expect(balanceCents(after.entries)).toBe(1_400);
    assertInvariants(after);
  });
});
