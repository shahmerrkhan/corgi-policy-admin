import { assertTerm, daysBetween, type IsoDate, type Term } from "./dates";
import { DomainError } from "./errors";
import { assertCents, roundHalfUp, safeMultiply } from "./money";

/**
 * round_half_up(premium x daysInEffect / daysInTerm), rounded once.
 * daysInTerm must be positive; daysInEffect may be 0 (nothing earned yet) up to daysInTerm.
 * A daily rate is never computed.
 */
export function prorate(premiumCents: number, daysInEffect: number, daysInTerm: number): number {
  assertCents(premiumCents, "premiumCents");
  if (premiumCents < 0) throw new DomainError(`premiumCents must not be negative, got ${premiumCents}`);
  if (!Number.isSafeInteger(daysInTerm) || daysInTerm <= 0) {
    throw new DomainError(`daysInTerm must be a positive whole number, got ${daysInTerm}`);
  }
  if (!Number.isSafeInteger(daysInEffect) || daysInEffect < 0 || daysInEffect > daysInTerm) {
    throw new DomainError(`daysInEffect must be 0..${daysInTerm}, got ${daysInEffect}`);
  }
  return roundHalfUp(safeMultiply(premiumCents, daysInEffect), daysInTerm);
}

/** Charge for coverage effective from `effectiveDate` to term end (end excluded). */
export function chargeForEffectiveDate(term: Term, premiumCents: number, effectiveDate: IsoDate): number {
  assertTerm(term);
  const days = daysBetween(effectiveDate, term.end);
  if (days <= 0 || days > term.days) {
    throw new DomainError(`effective date ${effectiveDate} is outside the term ${term.start} to ${term.end}`);
  }
  return prorate(premiumCents, days, term.days);
}
