import { describe, expect, it } from "vitest";
import { DomainError, premiumCents, prorate, roundHalfUp } from "@/lib/domain";
import { TERM_2026, TERM_LEAP } from "./fixtures";

describe("roundHalfUp", () => {
  it.each([
    [0, 3, 0],
    [1, 3, 0],
    [3, 2, 2], // 1.5 -> 2
    [5, 2, 3], // 2.5 -> 3
    [49, 100, 0],
    [50, 100, 1],
    [22338000, 365, 61200],
  ])("roundHalfUp(%i, %i) = %i", (n, d, expected) => {
    expect(roundHalfUp(n, d)).toBe(expected);
  });

  it.each([-1, -50, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "throws on a negative or non-safe-integer numerator %s",
    (n) => {
      expect(() => roundHalfUp(n, 3)).toThrow(DomainError);
    },
  );

  it.each([0, -1, 2.5])("throws on a bad denominator %s", (d) => {
    expect(() => roundHalfUp(10, d)).toThrow(DomainError);
  });
});

describe("premiumCents", () => {
  it("$73,000 limit at 100 bps is exactly $730.00", () => {
    expect(premiumCents(7_300_000, 100)).toBe(73_000);
  });

  it("rounds once, half up", () => {
    expect(premiumCents(5, 1000)).toBe(1); // 0.5 -> 1
    expect(premiumCents(4, 1000)).toBe(0); // 0.4 -> 0
  });

  it.each([
    [100.5, 100],
    [7_300_000, 1.5],
    [0, 100],
    [7_300_000, 0],
    [Number.MAX_SAFE_INTEGER, 100],
  ])("throws on bad input limit=%s rate=%s", (limit, rate) => {
    expect(() => premiumCents(limit, rate)).toThrow(DomainError);
  });
});

describe("prorate", () => {
  it("306 of 365 days of $730 is $612.00", () => {
    expect(prorate(73_000, 306, TERM_2026.days)).toBe(61_200);
  });

  it("313 of 365 days of $730 is $626.00", () => {
    expect(prorate(73_000, 313, TERM_2026.days)).toBe(62_600);
  });

  it("the same 306 days in a 366-day term is 61,033", () => {
    expect(TERM_LEAP.days).toBe(366);
    expect(prorate(73_000, 306, TERM_LEAP.days)).toBe(61_033);
  });

  it("allows 0 days in effect and the full term", () => {
    expect(prorate(73_000, 0, 365)).toBe(0);
    expect(prorate(73_000, 365, 365)).toBe(73_000);
  });

  it.each([
    [73_000, -1, 365],
    [73_000, 366, 365],
    [73_000, 10, 0],
    [73_000, 10, -365],
    [73_000.5, 10, 365],
    [-1, 10, 365],
  ])("throws on bad input premium=%s days=%s term=%s", (p, d, t) => {
    expect(() => prorate(p, d, t)).toThrow(DomainError);
  });
});
