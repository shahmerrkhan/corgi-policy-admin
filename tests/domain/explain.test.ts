import { describe, expect, it } from "vitest";
import {
  balanceCents,
  explainCharge,
  roundingStep,
  runningBalances,
  type ChargeEntry,
  type LedgerEntry,
  type Term,
} from "@/lib/domain";

const term: Term = { start: "2026-01-01", end: "2027-01-01", days: 365 };

function charge(over: Partial<ChargeEntry> = {}): ChargeEntry {
  return {
    id: "c1",
    type: "CHARGE",
    date: "2026-01-01",
    seq: 1,
    amountCents: 73_000,
    effectiveDate: "2026-01-01",
    premiumCents: 73_000,
    rebookOf: null,
    coverageLineId: null,
    daysInEffect: 365,
    daysInTerm: 365,
    ...over,
  };
}

describe("roundingStep", () => {
  it("is exact when there is no remainder", () => {
    expect(roundingStep(730_000_000, 10_000)).toEqual({
      numerator: 730_000_000,
      denominator: 10_000,
      quotient: 73_000,
      remainder: 0,
      roundedUp: false,
      resultCents: 73_000,
    });
  });

  it("rounds down below half and up at or above half", () => {
    expect(roundingStep(123_457, 10_000)).toMatchObject({ quotient: 12, remainder: 3_457, roundedUp: false, resultCents: 12 });
    expect(roundingStep(617_285, 10_000)).toMatchObject({ quotient: 61, remainder: 7_285, roundedUp: true, resultCents: 62 });
    expect(roundingStep(15, 10)).toMatchObject({ quotient: 1, remainder: 5, roundedUp: true, resultCents: 2 });
  });
});

describe("explainCharge", () => {
  it("explains the $73,000 x 100 bps full-term charge as exact", () => {
    const e = explainCharge({ limitCents: 7_300_000, rateBps: 100, term, charge: charge() });
    expect(e.premium).toMatchObject({ numerator: 730_000_000, resultCents: 73_000, remainder: 0 });
    expect(e.termDays).toBe(365);
    expect(e.daysInEffect).toBe(365);
    expect(e.proration).toMatchObject({ numerator: 73_000 * 365, denominator: 365, resultCents: 73_000, remainder: 0 });
    expect(e.matchesStored).toBe(true);
  });

  it("shows the remainder of a prorated charge (rounded down)", () => {
    // 100,001 x 200 / 365 = 54,795 r 25 -> 54,795
    const c = charge({ premiumCents: 100_001, amountCents: 54_795, effectiveDate: "2026-06-15" });
    const e = explainCharge({ limitCents: 10_000_100, rateBps: 100, term, charge: c });
    expect(e.daysInEffect).toBe(200);
    expect(e.proration).toMatchObject({ quotient: 54_795, remainder: 25, roundedUp: false, resultCents: 54_795 });
    expect(e.matchesStored).toBe(true);
  });

  it("shows a prorated charge rounded up", () => {
    // 1,000 x 1 / 365 = 2 r 270 -> 3
    const c = charge({ premiumCents: 1_000, amountCents: 3, effectiveDate: "2026-12-31" });
    const e = explainCharge({ limitCents: 100_000, rateBps: 100, term, charge: c });
    expect(e.proration).toMatchObject({ quotient: 2, remainder: 270, roundedUp: true, resultCents: 3 });
    expect(e.matchesStored).toBe(true);
  });

  it("flags a stored amount that does not match, without throwing", () => {
    const e = explainCharge({ limitCents: 7_300_000, rateBps: 100, term, charge: charge({ amountCents: 72_999 }) });
    expect(e.matchesStored).toBe(false);
    expect(e.storedAmountCents).toBe(72_999);
    expect(e.proration?.resultCents).toBe(73_000);
  });

  it("flags a premium that does not match the limit and rate", () => {
    const e = explainCharge({ limitCents: 7_300_000, rateBps: 101, term, charge: charge() });
    expect(e.premium.resultCents).toBe(73_730);
    expect(e.matchesStored).toBe(false);
  });

  it("has no proration step when the effective date is outside the term", () => {
    const e = explainCharge({ limitCents: 7_300_000, rateBps: 100, term, charge: charge({ effectiveDate: "2027-01-01" }) });
    expect(e.daysInEffect).toBe(0);
    expect(e.proration).toBeNull();
    expect(e.matchesStored).toBe(false);
  });
});

describe("runningBalances", () => {
  it("orders by date then seq and accumulates; the last balance equals balanceCents", () => {
    const entries: LedgerEntry[] = [
      { id: "p", type: "PAYMENT", date: "2026-02-01", seq: 2, amountCents: -50_000, paymentId: "pay" },
      { id: "r", type: "REVERSAL", date: "2026-03-01", seq: 3, amountCents: -73_000, reversesEntryId: "c1" },
      charge(),
      charge({ id: "c2", date: "2026-03-01", seq: 4, amountCents: 40_000, rebookOf: "c1" }),
    ];
    const out = runningBalances(entries);
    expect(out.map((r) => [r.entry.id, r.balanceCents])).toEqual([
      ["c1", 73_000],
      ["p", 23_000],
      ["r", -50_000],
      ["c2", -10_000],
    ]);
    expect(out.at(-1)?.balanceCents).toBe(balanceCents(entries));
  });

  it("is empty for no entries", () => {
    expect(runningBalances([])).toEqual([]);
  });
});
