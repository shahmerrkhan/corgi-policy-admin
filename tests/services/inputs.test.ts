import { describe, expect, it } from "vitest";
import {
  FEB29_MESSAGE,
  isUuid,
  parseAddCoverageInput,
  parseCustomerInput,
  parseDateField,
  parseDollarsToCents,
  parseIssuePolicyInput,
  parseRateBps,
} from "@/lib/services/inputs";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const good = { customerId: CUSTOMER_ID, termStart: "2026-01-01", transactionDate: "2026-01-01", limit: "73,000", rateBps: "100" };

describe("parseDollarsToCents", () => {
  it.each([
    ["73000", 7_300_000],
    ["73,000", 7_300_000],
    ["$73,000", 7_300_000],
    ["73000.5", 7_300_050],
    ["73000.50", 7_300_050],
    ["1,000,000.01", 100_000_001],
    ["0", 0],
    [" 1000 ", 100_000],
  ])("%s -> %i cents", (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each(["", "-1", "1e5", "73,00", "7,3000", "1.234", ".5", "1.", "abc", "1,000,", "12 000", "1000000000000"])(
    "rejects %j",
    (text) => {
      expect(parseDollarsToCents(text)).toBeNull();
    },
  );

  it("never produces a non-integer", () => {
    for (const t of ["0.01", "0.1", "0.29", "1234.57", "99999999.99"]) {
      expect(Number.isSafeInteger(parseDollarsToCents(t))).toBe(true);
    }
    expect(parseDollarsToCents("0.29")).toBe(29);
  });
});

describe("parseRateBps", () => {
  it("accepts whole bps 1..10000", () => {
    expect(parseRateBps("1")).toBe(1);
    expect(parseRateBps("10000")).toBe(10000);
  });
  it.each(["0", "10001", "1.5", "-1", "", "1e2", " 5"])("rejects %j", (t) => {
    expect(parseRateBps(t)).toBeNull();
  });
});

describe("parseDateField / isUuid", () => {
  it("accepts real dates only", () => {
    expect(parseDateField("2028-02-29")).toBe("2028-02-29");
    expect(parseDateField("2026-02-29")).toBeNull();
    expect(parseDateField("2026-1-01")).toBeNull();
  });
  it("checks uuids", () => {
    expect(isUuid(CUSTOMER_ID)).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid("' OR 1=1 --")).toBe(false);
  });
});

describe("parseIssuePolicyInput", () => {
  it("parses a valid form", () => {
    expect(parseIssuePolicyInput(good)).toEqual({
      ok: true,
      value: { customerId: CUSTOMER_ID, termStart: "2026-01-01", transactionDate: "2026-01-01", limitCents: 7_300_000, rateBps: 100 },
    });
  });

  it("rejects a Feb 29 term start with the clear message", () => {
    const r = parseIssuePolicyInput({ ...good, termStart: "2028-02-29" });
    expect(r).toEqual({ ok: false, errors: { termStart: FEB29_MESSAGE } });
  });

  it("enforces the limit range $1,000 to $100,000,000", () => {
    expect(parseIssuePolicyInput({ ...good, limit: "1000" }).ok).toBe(true);
    expect(parseIssuePolicyInput({ ...good, limit: "100,000,000" }).ok).toBe(true);
    expect(parseIssuePolicyInput({ ...good, limit: "999.99" }).ok).toBe(false);
    expect(parseIssuePolicyInput({ ...good, limit: "100000000.01" }).ok).toBe(false);
  });

  it("reports every bad field and ignores non-string values", () => {
    const r = parseIssuePolicyInput({ customerId: ["a"], termStart: "x", transactionDate: 5, limit: "-1", rateBps: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["customerId", "limit", "rateBps", "termStart", "transactionDate"]);
  });

  it("allows any transaction date relative to term start", () => {
    expect(parseIssuePolicyInput({ ...good, transactionDate: "2025-06-01" }).ok).toBe(true);
    expect(parseIssuePolicyInput({ ...good, transactionDate: "2027-06-01" }).ok).toBe(true);
  });
});

describe("parseCustomerInput", () => {
  const customer = {
    legalName: " Acme Ltd. ",
    contactName: "Sam Lee",
    email: "Sam@Example.com",
    phone: "+1 416 555 0100",
    addressLine1: "1 Main St",
    addressLine2: "",
    city: "Toronto",
    region: "ON",
    postalCode: "M5H 1A1",
    country: "",
    businessDescription: "Roofing",
  };

  it("trims, lowercases the email, defaults country to CA and nulls an empty line 2", () => {
    const r = parseCustomerInput(customer);
    expect(r).toEqual({
      ok: true,
      value: { ...customer, legalName: "Acme Ltd.", email: "sam@example.com", addressLine2: null, country: "CA" },
    });
  });

  it("requires every field except address line 2", () => {
    const r = parseCustomerInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ["addressLine1", "businessDescription", "city", "contactName", "email", "legalName", "phone", "postalCode", "region"].sort(),
      );
    }
  });

  it("checks email, phone, country and lengths", () => {
    const r = parseCustomerInput({ ...customer, email: "nope", phone: "abc", country: "CAN", legalName: "x".repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["country", "email", "legalName", "phone"]);
  });
});

describe("parseAddCoverageInput", () => {
  const ok = { name: "  Liquor Liability ", limit: "$73,000", rateBps: "100", effectiveDate: "2026-03-01", transactionDate: "2026-11-13" };

  it("parses to integer cents and a trimmed name", () => {
    expect(parseAddCoverageInput(ok)).toEqual({
      ok: true,
      value: { name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100, effectiveDate: "2026-03-01", transactionDate: "2026-11-13" },
    });
  });

  it.each([
    ["name", { name: "   " }],
    ["name", { name: "x".repeat(101) }],
    ["limit", { limit: "0" }],
    ["limit", { limit: "999.99" }],
    ["limit", { limit: "73000.001" }],
    ["limit", { limit: "-73000" }],
    ["limit", { limit: "100,000,000.01" }],
    ["rateBps", { rateBps: "0" }],
    ["rateBps", { rateBps: "10001" }],
    ["rateBps", { rateBps: "1.5" }],
    ["effectiveDate", { effectiveDate: "2026-02-30" }],
    ["effectiveDate", { effectiveDate: "" }],
    ["transactionDate", { transactionDate: "13/11/2026" }],
  ])("rejects a bad %s: %j", (field, over) => {
    const r = parseAddCoverageInput({ ...ok, ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual([field]);
  });

  it("accepts the rate bounds 1 and 10000 and the limit bounds", () => {
    expect(parseAddCoverageInput({ ...ok, rateBps: "1", limit: "1,000" }).ok).toBe(true);
    expect(parseAddCoverageInput({ ...ok, rateBps: "10000", limit: "100,000,000" }).ok).toBe(true);
  });
});
