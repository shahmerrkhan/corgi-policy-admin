// Untrusted form / query input -> typed values. Integer math only, never floats.
// Field errors are for the user; nothing here throws on bad input.
import { assertIsoDate, makeTerm } from "@/lib/domain";

export const LIMIT_MIN_CENTS = 100_000; // $1,000.00
export const LIMIT_MAX_CENTS = 10_000_000_000; // $100,000,000.00
export const RATE_MIN_BPS = 1;
export const RATE_MAX_BPS = 10_000;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type Parsed<T, K extends string> = { ok: true; value: T } | { ok: false; errors: FieldErrors<K> };

type Raw = Record<string, unknown>;

/** Trimmed string value of a form or query field ("" for missing, files or arrays). */
export function str(raw: Raw, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// "$73,000", "73000", "73,000.5", "73000.50". Commas must group thousands correctly.
const DOLLARS_RE = /^\$?((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{1,2}))?$/;

/** Dollars text -> integer cents, or null if it is not a plain non-negative amount. */
export function parseDollarsToCents(text: string): number | null {
  const m = DOLLARS_RE.exec(text.trim());
  if (!m || m[1] === undefined) return null;
  const whole = m[1].replace(/,/g, "");
  if (whole.length > 12) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  return Number(whole) * 100 + Number(frac);
}

/** Whole-number basis points in range, or null. */
export function parseRateBps(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= RATE_MIN_BPS && n <= RATE_MAX_BPS ? n : null;
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function parseDateField(text: string): string | null {
  try {
    return assertIsoDate(text);
  } catch {
    return null;
  }
}

export type IssuePolicyInput = {
  customerId: string;
  termStart: string;
  transactionDate: string;
  limitCents: number;
  rateBps: number;
};

export type IssuePolicyField = "customerId" | "termStart" | "transactionDate" | "limit" | "rateBps";

export const FEB29_MESSAGE = "A term cannot start on Feb 29. Choose Feb 28 or Mar 1.";

export function parseIssuePolicyInput(raw: Raw): Parsed<IssuePolicyInput, IssuePolicyField> {
  const errors: FieldErrors<IssuePolicyField> = {};

  const customerId = str(raw, "customerId");
  if (!isUuid(customerId)) errors.customerId = "Choose a customer.";

  const termStart = parseDateField(str(raw, "termStart"));
  if (!termStart) errors.termStart = "Enter the term start as a real date (YYYY-MM-DD).";
  else if (!makeTerm(termStart).ok) errors.termStart = FEB29_MESSAGE;

  const transactionDate = parseDateField(str(raw, "transactionDate"));
  if (!transactionDate) errors.transactionDate = "Enter the transaction date as a real date (YYYY-MM-DD).";

  const limitCents = parseDollarsToCents(str(raw, "limit"));
  if (limitCents === null) {
    errors.limit = "Enter the limit in dollars, for example 1,000,000 or 1000000.00.";
  } else if (limitCents < LIMIT_MIN_CENTS || limitCents > LIMIT_MAX_CENTS) {
    errors.limit = "Limit must be between $1,000 and $100,000,000.";
  }

  const rateBps = parseRateBps(str(raw, "rateBps"));
  if (rateBps === null) errors.rateBps = "Rate must be a whole number of basis points from 1 to 10000.";

  if (Object.keys(errors).length > 0 || !termStart || !transactionDate || limitCents === null || rateBps === null) {
    return { ok: false, errors };
  }
  return { ok: true, value: { customerId, termStart, transactionDate, limitCents, rateBps } };
}

export type CustomerInput = {
  legalName: string;
  contactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  businessDescription: string;
};

export type CustomerField = keyof CustomerInput;

const CUSTOMER_TEXT: { key: CustomerField; label: string; max: number; optional?: boolean }[] = [
  { key: "legalName", label: "Legal name", max: 200 },
  { key: "contactName", label: "Contact name", max: 200 },
  { key: "email", label: "Email", max: 254 },
  { key: "phone", label: "Phone", max: 40 },
  { key: "addressLine1", label: "Address line 1", max: 200 },
  { key: "addressLine2", label: "Address line 2", max: 200, optional: true },
  { key: "city", label: "City", max: 100 },
  { key: "region", label: "Province or state", max: 100 },
  { key: "postalCode", label: "Postal code", max: 20 },
  { key: "country", label: "Country", max: 2 },
  { key: "businessDescription", label: "Business description", max: 1000 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()\-.]{7,40}$/;

export function parseCustomerInput(raw: Raw): Parsed<CustomerInput, CustomerField> {
  const errors: FieldErrors<CustomerField> = {};
  const v: Record<string, string> = {};
  for (const f of CUSTOMER_TEXT) {
    let value = str(raw, f.key);
    if (f.key === "country") value = (value || "CA").toUpperCase();
    if (f.key === "email") value = value.toLowerCase();
    v[f.key] = value;
    if (!value && !f.optional) errors[f.key] = `${f.label} is required.`;
    else if (value.length > f.max) errors[f.key] = `${f.label} must be at most ${f.max} characters.`;
  }
  if (!errors.email && !EMAIL_RE.test(v.email ?? "")) errors.email = "Enter a valid email address.";
  if (!errors.phone && !PHONE_RE.test(v.phone ?? "")) errors.phone = "Enter a valid phone number.";
  if (!errors.country && !/^[A-Z]{2}$/.test(v.country ?? "")) errors.country = "Use a two-letter country code, for example CA.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      legalName: v.legalName ?? "",
      contactName: v.contactName ?? "",
      email: v.email ?? "",
      phone: v.phone ?? "",
      addressLine1: v.addressLine1 ?? "",
      addressLine2: v.addressLine2 ? v.addressLine2 : null,
      city: v.city ?? "",
      region: v.region ?? "",
      postalCode: v.postalCode ?? "",
      country: v.country ?? "CA",
      businessDescription: v.businessDescription ?? "",
    },
  };
}
