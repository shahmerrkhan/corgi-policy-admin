// Calendar dates as plain "YYYY-MM-DD" strings. All math is integer days-from-civil
// (Howard Hinnant's algorithm). No Date objects are used, so local time zones and DST
// can never shift a date.

import { DomainError, fail, ok, type Result } from "./errors";
import { intDiv } from "./int";

export type IsoDate = string;

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface Term {
  start: IsoDate;
  /** Excluded: the term is [start, end). */
  end: IsoDate;
  /** Actual days in the term (365 or 366). */
  days: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Validates a "YYYY-MM-DD" string (real calendar day, year 0001-9999). Throws otherwise. */
export function parseIsoDate(value: unknown): CivilDate {
  if (typeof value !== "string") {
    throw new DomainError(`date must be a YYYY-MM-DD string, got ${String(value)}`);
  }
  const m = ISO_RE.exec(value);
  if (!m) throw new DomainError(`date must be YYYY-MM-DD, got "${value}"`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DomainError(`not a calendar date: "${value}"`);
  }
  return { year, month, day };
}

export function assertIsoDate(value: unknown, label = "date"): IsoDate {
  try {
    parseIsoDate(value);
  } catch (e) {
    throw new DomainError(`${label}: ${(e as Error).message}`);
  }
  return value as IsoDate;
}

export function formatIsoDate({ year, month, day }: CivilDate): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days since 1970-01-01 for a civil date. */
export function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = intDiv(y, 400);
  const yoe = y - era * 400;
  const doy = intDiv(153 * (month > 2 ? month - 3 : month + 9) + 2, 5) + day - 1;
  const doe = yoe * 365 + intDiv(yoe, 4) - intDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = intDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = intDiv(doe - intDiv(doe, 1460) + intDiv(doe, 36524) - intDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + intDiv(yoe, 4) - intDiv(yoe, 100));
  const mp = intDiv(5 * doy + 2, 153);
  const day = doy - intDiv(153 * mp + 2, 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function toDays(d: IsoDate): number {
  return daysFromCivil(parseIsoDate(d));
}

/** Whole days from a to b (b excluded), negative if b is before a. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDays(b) - toDays(a);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  if (!Number.isSafeInteger(n)) throw new DomainError(`addDays needs whole days, got ${n}`);
  return formatIsoDate(civilFromDays(toDays(d) + n));
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  const d = daysBetween(b, a);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

export function isFeb29(d: IsoDate): boolean {
  const c = parseIsoDate(d);
  return c.month === 2 && c.day === 29;
}

/** Same month and day next year. Throws on Feb 29 (no such day next year). */
export function addTwelveMonths(start: IsoDate): IsoDate {
  const c = parseIsoDate(start);
  if (c.month === 2 && c.day === 29) {
    throw new DomainError(`addTwelveMonths is undefined for Feb 29 (${start})`);
  }
  return formatIsoDate({ ...c, year: c.year + 1 });
}

/** A 12-month term starting on `start`. Feb 29 starts are rejected. */
export function makeTerm(start: IsoDate): Result<Term> {
  assertIsoDate(start, "term start");
  if (isFeb29(start)) {
    return fail("INVALID_TERM_START", "A term cannot start on Feb 29.", { start });
  }
  const end = addTwelveMonths(start);
  return ok({ start, end, days: daysBetween(start, end) });
}

/** Throws unless the term is exactly 12 months with correct actual day count. */
export function assertTerm(term: Term): Term {
  assertIsoDate(term.start, "term start");
  assertIsoDate(term.end, "term end");
  if (isFeb29(term.start)) throw new DomainError(`term cannot start on Feb 29 (${term.start})`);
  const end = addTwelveMonths(term.start);
  if (term.end !== end) {
    throw new DomainError(`term must be exactly 12 months: ${term.start} to ${term.end}`);
  }
  if (term.days !== daysBetween(term.start, term.end)) {
    throw new DomainError(`term days ${term.days} do not match ${term.start} to ${term.end}`);
  }
  return term;
}

/** start <= d < end */
export function isDateInTerm(d: IsoDate, term: Term): boolean {
  return compareIsoDate(d, term.start) >= 0 && compareIsoDate(d, term.end) < 0;
}

/** True when cancelDate is more than 30 days before today. */
export function isBackdatedOver30Days(cancelDate: IsoDate, today: IsoDate): boolean {
  return daysBetween(cancelDate, today) > 30;
}
