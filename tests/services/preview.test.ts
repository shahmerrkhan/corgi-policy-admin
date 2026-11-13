import { describe, expect, it } from "vitest";
import { premiumCents } from "@/lib/domain";
import { previewIssue } from "@/lib/services/issue-policy";
import { todayIso } from "@/lib/services/today";

describe("previewIssue", () => {
  it("shows the domain premium and a full-term charge", () => {
    const r = previewIssue({ termStart: "2026-01-01", limitCents: 7_300_000, rateBps: 100 });
    expect(r).toEqual({
      ok: true,
      value: { term: { start: "2026-01-01", end: "2027-01-01", days: 365 }, premiumCents: 73_000, chargeCents: 73_000 },
    });
  });

  it("matches premiumCents with round half up and a leap-spanning term", () => {
    const r = previewIssue({ termStart: "2027-06-15", limitCents: 100_001, rateBps: 5 });
    expect(r.ok && r.value).toMatchObject({ premiumCents: premiumCents(100_001, 5), term: { days: 366 } });
    expect(premiumCents(100_001, 5)).toBe(50);
  });

  it("rejects a Feb 29 start", () => {
    expect(previewIssue({ termStart: "2028-02-29", limitCents: 100_000, rateBps: 1 })).toMatchObject({
      ok: false,
      code: "INVALID_TERM_START",
    });
  });
});

describe("todayIso", () => {
  it("is the Toronto calendar date", () => {
    // 2026-11-13 03:30 UTC is still Nov 12 in Toronto (UTC-5).
    expect(todayIso(new Date("2026-11-13T03:30:00Z"))).toBe("2026-11-12");
    expect(todayIso(new Date("2026-11-13T05:30:00Z"))).toBe("2026-11-13");
  });
});
