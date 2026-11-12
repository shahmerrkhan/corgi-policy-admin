import { DomainError } from "./errors";
import { intDiv } from "./int";

/** Throws unless value is a safe integer (cents). Returns it for chaining. */
export function assertCents(value: unknown, label = "cents"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new DomainError(`${label} must be integer cents, got ${String(value)}`);
  }
  return value;
}

export function assertPositiveCents(value: unknown, label = "cents"): number {
  const v = assertCents(value, label);
  if (v <= 0) throw new DomainError(`${label} must be positive, got ${v}`);
  return v;
}

/** a * b, throwing if the product leaves the safe-integer range. */
export function safeMultiply(a: number, b: number): number {
  assertCents(a, "factor");
  assertCents(b, "factor");
  const p = a * b;
  if (!Number.isSafeInteger(p)) {
    throw new DomainError(`product ${a} x ${b} is not a safe integer`);
  }
  return p;
}

/**
 * round_half_up(numerator / denominator) in pure integer math.
 * Only non-negative numerators are allowed, so "half up" is never ambiguous with
 * "half away from zero". Negative amounts (reversals, credits) are made by negating
 * a rounded positive amount, never by rounding a negative one.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new DomainError(`roundHalfUp numerator must be a non-negative safe integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new DomainError(`roundHalfUp denominator must be a positive safe integer, got ${denominator}`);
  }
  const q = intDiv(numerator, denominator);
  const r = numerator - q * denominator;
  return r >= denominator - r ? q + 1 : q;
}

/** Full-term premium: round_half_up(limit_cents x rate_bps / 10000), rounded once. */
export function premiumCents(limitCents: number, rateBps: number): number {
  assertPositiveCents(limitCents, "limitCents");
  if (!Number.isSafeInteger(rateBps) || rateBps <= 0) {
    throw new DomainError(`rateBps must be a positive whole number, got ${rateBps}`);
  }
  return roundHalfUp(safeMultiply(limitCents, rateBps), 10000);
}
