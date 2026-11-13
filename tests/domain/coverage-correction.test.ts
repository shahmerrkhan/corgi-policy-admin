// Step 9: correcting a coverage line's effective date (reverse-and-rebook of its live charge).
import { describe, expect, it } from "vitest";
import {
  assertInvariants,
  balanceCents,
  latestEntryDate,
  liveChargeForLine,
  planCoverageCorrection,
  type LedgerState,
  type PlanCoverageCorrectionInput,
} from "@/lib/domain";
import { alloc, apply, charge, idGen, must, payment, paymentEntry, TERM_2026 } from "./fixtures";

const LINE = "line-liquor";

/** Liquor Liability: $73,000 at 100 bps = $730; effective 2026-03-01 = 306/365 = $612.00. */
const liquor = (over: Parameters<typeof charge>[0] = { id: "c1", amountCents: 61_200 }) =>
  charge({
    date: "2026-03-01",
    seq: 1,
    effectiveDate: "2026-03-01",
    premiumCents: 73_000,
    coverageLineId: LINE,
    daysInEffect: 306,
    daysInTerm: 365,
    ...over,
  });

function input(state: LedgerState, over: Partial<PlanCoverageCorrectionInput> = {}): PlanCoverageCorrectionInput {
  return {
    ...state,
    term: TERM_2026,
    coverageLineId: LINE,
    expectedChargeId: "c1",
    newEffectiveDate: "2026-02-22",
    date: "2026-03-22",
    reason: "Broker keyed the wrong start date",
    policyCancelled: false,
    newId: idGen("n"),
    ...over,
  };
}

const UNPAID: LedgerState = { entries: [liquor()], allocations: [], payments: [] };

function paidInFull(): LedgerState {
  const p = payment("pA", 61_200, "2026-03-05", 1);
  return { entries: [liquor(), paymentEntry(p, 2)], allocations: [alloc("pA", "c1", 61_200, "pe-pA")], payments: [p] };
}

describe("required scenario: $612.00 (306/365) corrected to $626.00 (313/365)", () => {
  it("unpaid: original stays, reversal -$612.00, rebook $626.00 with day counts, net +$14.00", () => {
    const v = must(planCoverageCorrection(input(UNPAID)));
    expect(v.original.id).toBe("c1");
    expect(v.reversal).toMatchObject({ type: "REVERSAL", amountCents: -61_200, reversesEntryId: "c1", date: "2026-03-22", seq: 2 });
    expect(v.rebook).toMatchObject({
      type: "CHARGE",
      amountCents: 62_600,
      effectiveDate: "2026-02-22",
      premiumCents: 73_000,
      rebookOf: "c1",
      coverageLineId: LINE,
      daysInEffect: 313,
      daysInTerm: 365,
      seq: 3,
    });
    expect(v.netChangeCents).toBe(1_400);
    expect([v.oldDaysInEffect, v.newDaysInEffect, v.daysInTerm]).toEqual([306, 313, 365]);
    expect(v.releases).toEqual([]);
    expect(v.allocations).toEqual([]);
    expect([v.balanceBeforeCents, v.balanceAfterCents]).toEqual([61_200, 62_600]);
    const after = apply(UNPAID, v);
    expect(after.entries.map((e) => [e.type, e.amountCents])).toEqual([
      ["CHARGE", 61_200],
      ["REVERSAL", -61_200],
      ["CHARGE", 62_600],
    ]);
    expect(balanceCents(after.entries)).toBe(62_600);
    assertInvariants(after);
  });

  it("fully paid: the reversal releases the payment, freed cash goes FIFO to the rebook, balance due $14.00", () => {
    const state = paidInFull();
    const v = must(planCoverageCorrection(input(state)));
    expect(v.releases).toEqual([{ paymentId: "pA", chargeId: "c1", amountCents: -61_200, sourceEntryId: v.reversal.id }]);
    expect(v.allocations).toEqual([{ paymentId: "pA", chargeId: v.rebook.id, amountCents: 61_200, sourceEntryId: v.rebook.id }]);
    expect(v.remainingByPayment).toEqual([{ paymentId: "pA", amountCents: 0 }]);
    expect([v.balanceBeforeCents, v.balanceAfterCents]).toEqual([0, 1_400]);
    const after = apply(state, v);
    expect(balanceCents(after.entries)).toBe(1_400);
    assertInvariants(after);
  });

  it("policy premium plus the line, paid by one $1,342.00 payment: only the line's cash moves, balance $14.00", () => {
    const base = charge({ id: "c0", amountCents: 73_000, premiumCents: 73_000, date: "2026-01-01", seq: 1, daysInEffect: 365, daysInTerm: 365 });
    const line = liquor({ id: "c1", amountCents: 61_200, seq: 2 });
    const p = payment("pA", 134_200, "2026-03-05", 1);
    const state: LedgerState = {
      entries: [base, line, paymentEntry(p, 3)],
      allocations: [alloc("pA", "c0", 73_000, "pe-pA"), alloc("pA", "c1", 61_200, "pe-pA")],
      payments: [p],
    };
    assertInvariants(state);
    const v = must(planCoverageCorrection(input(state)));
    expect(v.releases).toEqual([{ paymentId: "pA", chargeId: "c1", amountCents: -61_200, sourceEntryId: v.reversal.id }]);
    expect(v.allocations).toEqual([{ paymentId: "pA", chargeId: v.rebook.id, amountCents: 61_200, sourceEntryId: v.rebook.id }]);
    const after = apply(state, v);
    expect(balanceCents(after.entries)).toBe(1_400);
    assertInvariants(after);
  });
});

describe("coverage correction rules", () => {
  it("correcting to the term start charges the full $730.00", () => {
    const v = must(planCoverageCorrection(input(UNPAID, { newEffectiveDate: "2026-01-01" })));
    expect(v.rebook).toMatchObject({ amountCents: 73_000, daysInEffect: 365 });
    expect(v.netChangeCents).toBe(11_800);
    assertInvariants(apply(UNPAID, v));
  });

  it("rejects the same date", () => {
    expect(planCoverageCorrection(input(UNPAID, { newEffectiveDate: "2026-03-01" }))).toMatchObject({ ok: false, code: "SAME_EFFECTIVE_DATE" });
  });

  it.each([
    ["on the term end (excluded)", "2027-01-01"],
    ["the day before the term start", "2025-12-31"],
  ])("rejects a new date %s", (_l, newEffectiveDate) => {
    expect(planCoverageCorrection(input(UNPAID, { newEffectiveDate }))).toMatchObject({ ok: false, code: "EFFECTIVE_DATE_OUTSIDE_TERM" });
  });

  it("corrects twice in a row: the second reverses the rebook (02-15 = 320 days = $640.00)", () => {
    const first = must(planCoverageCorrection(input(UNPAID)));
    const s1 = apply(UNPAID, first);
    expect(liveChargeForLine(s1.entries, LINE).id).toBe(first.rebook.id);
    const second = must(
      planCoverageCorrection(input(s1, { expectedChargeId: first.rebook.id, newEffectiveDate: "2026-02-15", date: "2026-03-25", newId: idGen("m") })),
    );
    expect(second.reversal).toMatchObject({ amountCents: -62_600, reversesEntryId: first.rebook.id });
    expect(second.rebook).toMatchObject({ amountCents: 64_000, rebookOf: first.rebook.id, daysInEffect: 320 });
    const s2 = apply(s1, second);
    expect(balanceCents(s2.entries)).toBe(64_000);
    expect(liveChargeForLine(s2.entries, LINE).id).toBe(second.rebook.id);
    assertInvariants(s2);
  });

  it("a stale review (the charge it showed was already corrected) returns CHARGE_ALREADY_REVERSED with the latest charge", () => {
    const first = must(planCoverageCorrection(input(UNPAID)));
    const s1 = apply(UNPAID, first);
    const r = planCoverageCorrection(input(s1, { expectedChargeId: "c1", newEffectiveDate: "2026-02-15" }));
    expect(r).toMatchObject({ ok: false, code: "CHARGE_ALREADY_REVERSED", details: { latestChargeId: first.rebook.id } });
  });

  it("partial payment of $300.00: releases $300.00, re-allocates it to the rebook, balance $326.00", () => {
    const p = payment("pA", 30_000, "2026-03-05", 1);
    const state: LedgerState = { entries: [liquor(), paymentEntry(p, 2)], allocations: [alloc("pA", "c1", 30_000, "pe-pA")], payments: [p] };
    const v = must(planCoverageCorrection(input(state)));
    expect(v.releases).toEqual([{ paymentId: "pA", chargeId: "c1", amountCents: -30_000, sourceEntryId: v.reversal.id }]);
    expect(v.allocations).toEqual([{ paymentId: "pA", chargeId: v.rebook.id, amountCents: 30_000, sourceEntryId: v.rebook.id }]);
    const after = apply(state, v);
    expect(balanceCents(after.entries)).toBe(32_600);
    assertInvariants(after);
  });

  it("plain FIFO: freed cash pays an older open charge on another line before the rebook", () => {
    const p = payment("pA", 61_200, "2026-03-05", 1);
    const lineB = charge({ id: "cB", amountCents: 10_000, date: "2026-04-01", seq: 3, coverageLineId: "line-b" });
    const state: LedgerState = {
      entries: [liquor(), paymentEntry(p, 2), lineB],
      allocations: [alloc("pA", "c1", 61_200, "pe-pA")],
      payments: [p],
    };
    const v = must(planCoverageCorrection(input(state, { date: "2026-04-10" })));
    expect(v.allocations).toEqual([
      { paymentId: "pA", chargeId: "cB", amountCents: 10_000, sourceEntryId: v.rebook.id },
      { paymentId: "pA", chargeId: v.rebook.id, amountCents: 51_200, sourceEntryId: v.rebook.id },
    ]);
    const after = apply(state, v);
    expect(balanceCents(after.entries)).toBe(11_400);
    assertInvariants(after);
  });

  it("correcting to a later date after full payment leaves credit on account", () => {
    const state = paidInFull();
    // 2026-04-01: 275 days = $550.00, net -$62.00.
    const v = must(planCoverageCorrection(input(state, { newEffectiveDate: "2026-04-01" })));
    expect(v.rebook.amountCents).toBe(55_000);
    expect(v.allocations).toEqual([{ paymentId: "pA", chargeId: v.rebook.id, amountCents: 55_000, sourceEntryId: v.rebook.id }]);
    expect(v.remainingByPayment).toEqual([{ paymentId: "pA", amountCents: 6_200 }]);
    const after = apply(state, v);
    expect(balanceCents(after.entries)).toBe(-6_200);
    assertInvariants(after);
  });

  it("rounds half up once: $50,000 at 137 bps = $685.00; 306 days -> 302 days = 20,687,000 / 365 = 56,676 r 260 -> $566.77", () => {
    const original = liquor({ id: "c1", amountCents: 57_427, premiumCents: 68_500 });
    const state: LedgerState = { entries: [original], allocations: [], payments: [] };
    const v = must(planCoverageCorrection(input(state, { newEffectiveDate: "2026-03-05" })));
    expect(v.rebook).toMatchObject({ amountCents: 56_677, daysInEffect: 302 });
    expect(v.reversal.amountCents).toBe(-57_427);
    expect(v.netChangeCents).toBe(-750);
    assertInvariants(apply(state, v));
  });

  it.each([
    ["empty", "   ", "REASON_REQUIRED"],
    ["501 characters", "x".repeat(501), "REASON_TOO_LONG"],
  ])("rejects a reason that is %s", (_l, reason, code) => {
    expect(planCoverageCorrection(input(UNPAID, { reason }))).toMatchObject({ ok: false, code });
  });

  it("accepts a 500-character reason and stores it trimmed", () => {
    expect(must(planCoverageCorrection(input(UNPAID, { reason: ` ${"x".repeat(500)} ` }))).reason).toHaveLength(500);
  });

  it("rejects a transaction date before the latest ledger entry, accepts the same day", () => {
    const state = paidInFull(); // latest entry 2026-03-05
    expect(latestEntryDate(state.entries)).toBe("2026-03-05");
    expect(planCoverageCorrection(input(state, { date: "2026-03-04" }))).toMatchObject({
      ok: false,
      code: "TRANSACTION_DATE_TOO_EARLY",
      details: { latestEntryDate: "2026-03-05" },
    });
    expect(planCoverageCorrection(input(state, { date: "2026-03-05" })).ok).toBe(true);
  });

  it("rejects a charge from another line and a cancelled policy", () => {
    expect(planCoverageCorrection(input(UNPAID, { coverageLineId: "line-other" }))).toMatchObject({ ok: false, code: "LINE_MISMATCH" });
    expect(planCoverageCorrection(input(UNPAID, { policyCancelled: true }))).toMatchObject({ ok: false, code: "POLICY_CANCELLED" });
  });

  it("flags a new date more than 30 days before the transaction date", () => {
    expect(must(planCoverageCorrection(input(UNPAID, { date: "2026-03-24" }))).backdatedOver30Days).toBe(false); // 30 days
    expect(must(planCoverageCorrection(input(UNPAID, { date: "2026-03-25" }))).backdatedOver30Days).toBe(true); // 31 days
  });

  it("liveChargeForLine throws unless exactly one live charge exists", () => {
    expect(() => liveChargeForLine([], LINE)).toThrow(/0 live charges/);
    expect(() => liveChargeForLine([liquor(), liquor({ id: "c2", amountCents: 61_200, seq: 2 })], LINE)).toThrow(/2 live charges/);
  });
});
