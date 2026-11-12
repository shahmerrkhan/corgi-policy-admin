import { describe, expect, it } from "vitest";
import {
  addDays,
  assertInvariants,
  balanceCents,
  cancellationCredit,
  chargeForEffectiveDate,
  planCancellation,
  planCorrection,
  prorate,
  type LedgerState,
} from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry, TERM_2026 } from "./fixtures";

const baseInput = { term: TERM_2026, date: "2026-07-01", reason: "Insured sold the business", policyCancelled: false };

describe("cancellationCredit", () => {
  it("P = 100,001: earned + credit = charged for every effective/cancel date pair", () => {
    const P = 100_001;
    let checked = 0;
    for (let e = 0; e < TERM_2026.days; e += 3) {
      const eff = addDays(TERM_2026.start, e);
      const c = charge({ id: "c", amountCents: chargeForEffectiveDate(TERM_2026, P, eff), premiumCents: P, effectiveDate: eff });
      for (let k = 0; k < TERM_2026.days; k += 5) {
        const cancel = addDays(TERM_2026.start, k);
        const { earnedCents, creditCents } = cancellationCredit(c, TERM_2026, cancel);
        expect(earnedCents + creditCents).toBe(c.amountCents);
        expect(creditCents).toBeGreaterThanOrEqual(0);
        if (k > e) expect(earnedCents).toBe(prorate(P, k - e, TERM_2026.days));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8_000);
  });

  it("days_used counts from the charge's own effective date", () => {
    // Charge effective 2026-03-01 (61,200), cancel 2026-07-01: 122 days used -> earned 24,400.
    const c = charge({ id: "c", amountCents: 61_200, premiumCents: 73_000, effectiveDate: "2026-03-01" });
    expect(cancellationCredit(c, TERM_2026, "2026-07-01")).toEqual({ earnedCents: 24_400, creditCents: 36_800 });
  });

  it("a charge effective on or after the cancel date is credited in full", () => {
    const c = charge({ id: "c", amountCents: 61_200, premiumCents: 73_000, effectiveDate: "2026-03-01" });
    expect(cancellationCredit(c, TERM_2026, "2026-03-01")).toEqual({ earnedCents: 0, creditCents: 61_200 });
    expect(cancellationCredit(c, TERM_2026, "2026-02-01")).toEqual({ earnedCents: 0, creditCents: 61_200 });
  });
});

describe("planCancellation", () => {
  const c1 = charge({ id: "c1", amountCents: 61_200, premiumCents: 73_000, effectiveDate: "2026-03-01", date: "2026-03-01", seq: 1 });

  it("credit on an unpaid charge: no releases, no refund, earned stays owed", () => {
    const state: LedgerState = { entries: [c1], allocations: [], payments: [] };
    const r = must(planCancellation({ ...state, ...baseInput, cancelDate: "2026-07-01", newId: idGen("k") }));
    expect(r.credits.map((c) => [c.type, c.chargeId, c.amountCents])).toEqual([["CREDIT", "c1", -36_800]]);
    expect(r.releases).toEqual([]);
    expect(r.refundPreview).toEqual({ totalCents: 0, byPayment: [] });
    expect(balanceCents(apply(state, r).entries)).toBe(24_400);
  });

  it("credit on a partly paid charge releases only the excess", () => {
    const p = payment("p1", 40_000, "2026-03-05", 1);
    const state: LedgerState = { entries: [c1, paymentEntry(p, 2)], allocations: [alloc("p1", "c1", 40_000)], payments: [p] };
    // credit 36,800, unpaid 21,200 -> release 15,600, all refundable.
    const r = must(planCancellation({ ...state, ...baseInput, cancelDate: "2026-07-01", newId: idGen("k") }));
    expect(r.releases).toEqual([alloc("p1", "c1", -15_600, "k1")]);
    expect(r.allocations).toEqual([]);
    expect(r.refundPreview).toEqual({ totalCents: 15_600, byPayment: [{ paymentId: "p1", amountCents: 15_600 }] });
    const after = apply(state, r);
    assertInvariants(after);
    expect(balanceCents(after.entries)).toBe(-15_600);
  });

  it("credit on a fully paid charge releases the whole credit", () => {
    const p = payment("p1", 61_200, "2026-03-05", 1);
    const state: LedgerState = { entries: [c1, paymentEntry(p, 2)], allocations: [alloc("p1", "c1", 61_200)], payments: [p] };
    const r = must(planCancellation({ ...state, ...baseInput, cancelDate: "2026-07-01", newId: idGen("k") }));
    expect(r.returnPremiumCents).toBe(36_800);
    expect(r.releases).toEqual([alloc("p1", "c1", -36_800, "k1")]);
    expect(r.refundPreview.totalCents).toBe(36_800);
    assertInvariants(apply(state, r));
  });

  it("freed cash pays another charge's earned-but-unpaid part before it is refundable", () => {
    const base = charge({ id: "c0", amountCents: 50_000, premiumCents: 50_000, effectiveDate: "2026-01-01", date: "2026-01-01", seq: 0 });
    const p = payment("p1", 61_200, "2026-03-05", 1);
    const state: LedgerState = {
      entries: [base, c1, paymentEntry(p, 2)],
      allocations: [alloc("p1", "c1", 61_200)],
      payments: [p],
    };
    const r = must(planCancellation({ ...state, ...baseInput, cancelDate: "2026-07-01", newId: idGen("k") }));
    // c0 earned 181/365 of 50,000 = 24,795; credit 25,205 on an unpaid charge (no release).
    // c1 credit 36,800 fully released, then 24,795 goes to c0, 12,005 refundable.
    expect(r.credits.map((c) => c.amountCents)).toEqual([-25_205, -36_800]);
    expect(r.allocations).toEqual([alloc("p1", "c0", 24_795)]);
    expect(r.refundPreview.totalCents).toBe(12_005);
    const after = apply(state, r);
    assertInvariants(after);
    expect(balanceCents(after.entries)).toBe(-12_005);
  });

  it("cancelling after a correction credits only the rebook", () => {
    const newId = idGen("k");
    const state: LedgerState = { entries: [c1], allocations: [], payments: [] };
    const corr = must(planCorrection({ ...state, term: TERM_2026, chargeId: "c1", newEffectiveDate: "2026-02-22", date: "2026-03-22", policyCancelled: false, newId }));
    const s1 = apply(state, corr);
    const r = must(planCancellation({ ...s1, ...baseInput, cancelDate: "2026-07-01", newId }));
    expect(r.credits.map((c) => c.chargeId)).toEqual([corr.rebook.id]);
    // Rebook 62,600 from 2026-02-22; 129 days used -> earned 25,800; credit 36,800.
    expect(r.credits[0]?.amountCents).toBe(-36_800);
    expect(balanceCents(apply(s1, r).entries)).toBe(25_800);
  });

  it("refund preview splits newest payment first", () => {
    const pA = payment("pA", 30_000, "2026-03-05", 1);
    const pB = payment("pB", 31_200, "2026-03-10", 2);
    const state: LedgerState = {
      entries: [c1, paymentEntry(pA, 2), paymentEntry(pB, 3)],
      allocations: [alloc("pA", "c1", 30_000), alloc("pB", "c1", 31_200)],
      payments: [pA, pB],
    };
    const r = must(planCancellation({ ...state, ...baseInput, cancelDate: "2026-03-01", newId: idGen("k") }));
    expect(r.releases).toEqual([alloc("pB", "c1", -31_200, "k1"), alloc("pA", "c1", -30_000, "k1")]);
    expect(r.refundPreview.byPayment).toEqual([
      { paymentId: "pB", amountCents: 31_200 },
      { paymentId: "pA", amountCents: 30_000 },
    ]);
  });

  it("rejects: already cancelled, missing reason, date outside the term", () => {
    const state: LedgerState = { entries: [c1], allocations: [], payments: [] };
    const code = (over: Partial<typeof baseInput> & { cancelDate: string }) => {
      const r = planCancellation({ ...state, ...baseInput, newId: idGen(), ...over });
      return r.ok ? null : r.code;
    };
    expect(code({ cancelDate: "2026-07-01", policyCancelled: true })).toBe("POLICY_CANCELLED");
    expect(code({ cancelDate: "2026-07-01", reason: "   " })).toBe("REASON_REQUIRED");
    expect(code({ cancelDate: "2027-01-01" })).toBe("CANCEL_DATE_OUTSIDE_TERM");
    expect(code({ cancelDate: "2025-12-31" })).toBe("CANCEL_DATE_OUTSIDE_TERM");
    expect(code({ cancelDate: "2026-01-01" })).toBeNull();
  });

  it("warns when the cancel date is more than 30 days before the transaction date", () => {
    const state: LedgerState = { entries: [c1], allocations: [], payments: [] };
    const at = (cancelDate: string) =>
      must(planCancellation({ ...state, ...baseInput, date: "2026-08-01", cancelDate, newId: idGen() })).warnings.backdatedOver30Days;
    expect(at("2026-07-02")).toBe(false);
    expect(at("2026-07-01")).toBe(true);
  });
});
