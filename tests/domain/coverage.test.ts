import { describe, expect, it } from "vitest";
import { coverageNameKey, normalizeCoverageName, planAddCoverage, type PlanAddCoverageInput } from "@/lib/domain";
import { charge, idGen, must, payment, paymentEntry, TERM_2026, TERM_LEAP } from "./fixtures";

function input(over: Partial<PlanAddCoverageInput> = {}): PlanAddCoverageInput {
  return {
    term: TERM_2026,
    existingNames: [],
    name: "Liquor Liability",
    coverageLineId: "line-1",
    limitCents: 7_300_000,
    rateBps: 100,
    effectiveDate: "2026-03-01",
    date: "2026-03-01",
    policyCancelled: false,
    newId: idGen(),
    entries: [charge({ id: "c1", amountCents: 73_000 })],
    allocations: [],
    payments: [],
    ...over,
  };
}

describe("planAddCoverage", () => {
  it("$73,000 at 100 bps = $730 annual; effective 2026-03-01 is 306 of 365 days = $612.00", () => {
    const v = must(planAddCoverage(input()));
    expect(v.premiumCents).toBe(73_000);
    expect(v.daysInEffect).toBe(306);
    expect(v.daysInTerm).toBe(365);
    const [c] = v.entries;
    expect(c).toEqual({
      id: "e1",
      type: "CHARGE",
      date: "2026-03-01",
      seq: 2,
      amountCents: 61_200,
      effectiveDate: "2026-03-01",
      premiumCents: 73_000,
      rebookOf: null,
      coverageLineId: "line-1",
      daysInEffect: 306,
      daysInTerm: 365,
    });
    expect(v.allocations).toEqual([]);
  });

  it("effective on the term start charges the full premium (365 of 365)", () => {
    const v = must(planAddCoverage(input({ effectiveDate: "2026-01-01" })));
    expect(v.entries[0].amountCents).toBe(73_000);
    expect(v.daysInEffect).toBe(365);
  });

  it("effective on the last day of the term charges 1 day: round_half_up(73,000 / 365) = 200", () => {
    const v = must(planAddCoverage(input({ effectiveDate: "2026-12-31" })));
    expect(v.daysInEffect).toBe(1);
    expect(v.entries[0].amountCents).toBe(200);
  });

  it("rounds half up once on the prorated amount (366-day term)", () => {
    // 100,001 x 5 bps = 50.0005 -> 50 cents premium; 50 x 183 / 366 = 25 exactly.
    const v = must(planAddCoverage(input({ term: TERM_LEAP, limitCents: 100_001, rateBps: 5, effectiveDate: "2027-08-31", date: "2027-08-31", entries: [] })));
    expect(v.premiumCents).toBe(50);
    expect(v.daysInTerm).toBe(366);
    expect(v.daysInEffect).toBe(183);
    expect(v.entries[0].amountCents).toBe(25);
  });

  it.each([
    ["on the term end (excluded)", "2027-01-01"],
    ["after the term end", "2027-03-01"],
    ["the day before the term start", "2025-12-31"],
  ])("rejects an effective date %s", (_l, effectiveDate) => {
    const r = planAddCoverage(input({ effectiveDate }));
    expect(r).toMatchObject({ ok: false, code: "EFFECTIVE_DATE_OUTSIDE_TERM" });
  });

  it.each(["Liquor Liability", "liquor liability", "  LIQUOR LIABILITY  "])("rejects duplicate name %j", (name) => {
    const r = planAddCoverage(input({ existingNames: ["Liquor Liability"], name }));
    expect(r).toMatchObject({ ok: false, code: "DUPLICATE_COVERAGE_NAME" });
  });

  it("allows a different name on the same policy", () => {
    expect(planAddCoverage(input({ existingNames: ["Liquor Liability"], name: "Hired Auto" })).ok).toBe(true);
  });

  it.each(["", "   ", "x".repeat(101)])("rejects an invalid name %j", (name) => {
    expect(planAddCoverage(input({ name }))).toMatchObject({ ok: false, code: "INVALID_COVERAGE_NAME" });
  });

  it("stores the trimmed name", () => {
    expect(must(planAddCoverage(input({ name: "  Hired Auto " }))).name).toBe("Hired Auto");
  });

  it("rejects a cancelled policy", () => {
    expect(planAddCoverage(input({ policyCancelled: true }))).toMatchObject({ ok: false, code: "POLICY_CANCELLED" });
  });

  it("applies unapplied cash FIFO to the new charge", () => {
    // $730 charge fully paid plus $100 extra on account.
    const p = payment("p1", 83_000, "2026-01-10", 1);
    const v = must(
      planAddCoverage(
        input({
          entries: [charge({ id: "c1", amountCents: 73_000 }), paymentEntry(p, 2)],
          allocations: [{ paymentId: "p1", chargeId: "c1", amountCents: 73_000, sourceEntryId: "pe-p1" }],
          payments: [p],
        }),
      ),
    );
    const [c] = v.entries;
    expect(c.seq).toBe(3);
    expect(v.allocations).toEqual([{ paymentId: "p1", chargeId: c.id, amountCents: 10_000, sourceEntryId: c.id }]);
    expect(v.remainingByPayment).toEqual([{ paymentId: "p1", amountCents: 0 }]);
  });

  it.each([
    ["30 days before: no warning", "2026-03-31", false],
    ["31 days before: warning", "2026-04-01", true],
    ["same day: no warning", "2026-03-01", false],
    ["future-dated: no warning", "2026-02-01", false],
  ])("backdating warning, %s", (_l, date, expected) => {
    expect(must(planAddCoverage(input({ date }))).backdatedOver30Days).toBe(expected);
  });
});

describe("coverage names", () => {
  it("normalizes by trimming and keys case-insensitively", () => {
    expect(normalizeCoverageName("  Hired Auto ")).toBe("Hired Auto");
    expect(coverageNameKey("  Hired AUTO ")).toBe("hired auto");
  });
});
