import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  addTwelveMonths,
  assertTerm,
  civilFromDays,
  daysBetween,
  daysFromCivil,
  DomainError,
  isBackdatedOver30Days,
  isDateInTerm,
  makeTerm,
  parseIsoDate,
} from "@/lib/domain";
import { must, TERM_2026 } from "./fixtures";

describe("parseIsoDate", () => {
  it("parses a valid date", () => {
    expect(parseIsoDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it.each(["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "26-01-01", "2026-01-01T00:00:00Z", "", 20260101, null])(
    "rejects %s",
    (v) => {
      expect(() => parseIsoDate(v)).toThrow(DomainError);
    },
  );
});

describe("days-from-civil", () => {
  it("1970-01-01 is day 0 and round-trips across 400 years", () => {
    expect(daysFromCivil({ year: 1970, month: 1, day: 1 })).toBe(0);
    for (let d = -200_000; d <= 200_000; d += 997) {
      expect(daysFromCivil(civilFromDays(d))).toBe(d);
    }
  });

  it("daysBetween excludes the end date", () => {
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-03-01", "2027-01-01")).toBe(306);
    expect(daysBetween("2026-02-22", "2027-01-01")).toBe(313);
    expect(daysBetween("2027-01-01", "2026-03-01")).toBe(-306);
  });

  it("addDays crosses month, year and leap day", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("terms", () => {
  it("2026-01-01 term is 365 days, end excluded", () => {
    expect(TERM_2026).toEqual({ start: "2026-01-01", end: "2027-01-01", days: 365 });
  });

  it("a term spanning Feb 29 is 366 days", () => {
    expect(must(makeTerm("2027-03-01"))).toEqual({ start: "2027-03-01", end: "2028-03-01", days: 366 });
    expect(must(makeTerm("2028-01-15")).days).toBe(366);
  });

  it("a term starting Mar 1 of a leap year does not span Feb 29", () => {
    expect(must(makeTerm("2028-03-01")).days).toBe(365);
  });

  it("Feb 29 term start returns INVALID_TERM_START", () => {
    const r = makeTerm("2028-02-29");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_TERM_START");
    expect(() => addTwelveMonths("2028-02-29")).toThrow(DomainError);
  });

  it("assertTerm throws on a term that is not 12 months or has wrong days", () => {
    expect(() => assertTerm({ start: "2026-01-01", end: "2026-12-31", days: 364 })).toThrow(DomainError);
    expect(() => assertTerm({ start: "2026-01-01", end: "2027-01-01", days: 366 })).toThrow(DomainError);
    expect(assertTerm(TERM_2026)).toBe(TERM_2026);
  });

  it("isDateInTerm is [start, end)", () => {
    expect(isDateInTerm("2026-01-01", TERM_2026)).toBe(true);
    expect(isDateInTerm("2026-12-31", TERM_2026)).toBe(true);
    expect(isDateInTerm("2027-01-01", TERM_2026)).toBe(false);
    expect(isDateInTerm("2025-12-31", TERM_2026)).toBe(false);
  });
});

describe("isBackdatedOver30Days", () => {
  it("is true only when strictly more than 30 days before today", () => {
    expect(isBackdatedOver30Days("2026-10-13", "2026-11-12")).toBe(false); // 30 days
    expect(isBackdatedOver30Days("2026-10-12", "2026-11-12")).toBe(true); // 31 days
    expect(isBackdatedOver30Days("2026-11-20", "2026-11-12")).toBe(false); // future
  });
});

// process.env.TZ changes take effect at runtime in Node. Each block first proves the
// zone is really active, then runs the date math across DST changes.
describe.each([
  { tz: "America/New_York", januaryOffset: 300, localDayOfMar1: 28 },
  { tz: "Pacific/Kiritimati", januaryOffset: -840, localDayOfMar1: 1 },
])("under TZ=$tz", ({ tz, januaryOffset, localDayOfMar1 }) => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it("the time zone is in effect", () => {
    expect(new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset()).toBe(januaryOffset);
    // The trap the domain avoids: local getters on a parsed ISO date.
    expect(new Date("2026-03-01").getDate()).toBe(localDayOfMar1);
  });

  it("day counts and date steps across the US DST changes are exact", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addTwelveMonths("2026-03-08")).toBe("2027-03-08");
    expect(daysBetween("2026-03-01", "2027-01-01")).toBe(306);
    expect(must(makeTerm("2026-01-01")).days).toBe(365);
    expect(must(makeTerm("2027-03-01")).days).toBe(366);
    expect(parseIsoDate("2026-11-01")).toEqual({ year: 2026, month: 11, day: 1 });
  });
});
