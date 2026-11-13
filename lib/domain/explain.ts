// Explains how a stored charge was computed, step by step, for the statement screen.
// Reuses the pricing and proration rules; never changes a stored amount. If the
// recomputed result differs from what was stored, matchesStored is false and the
// caller shows a warning instead of failing.

import { daysBetween, type Term } from "./dates";
import { intDiv } from "./int";
import { roundHalfUp, safeMultiply } from "./money";
import type { ChargeEntry } from "./types";

/** One round_half_up(numerator / denominator) step, with its exact remainder. */
export interface RoundingStep {
  numerator: number;
  denominator: number;
  /** Floor of numerator / denominator. */
  quotient: number;
  /** numerator - quotient x denominator (0 means exact). */
  remainder: number;
  roundedUp: boolean;
  resultCents: number;
}

export interface ChargeExplanation {
  limitCents: number;
  rateBps: number;
  /** round_half_up(limit x rate_bps / 10000). */
  premium: RoundingStep;
  termDays: number;
  /** Days from the charge's effective date to term end (end excluded). */
  daysInEffect: number;
  /** round_half_up(P x daysInEffect / termDays), P = the charge's stored premium; null if the days are out of range. */
  proration: RoundingStep | null;
  storedPremiumCents: number;
  storedAmountCents: number;
  matchesStored: boolean;
}

export function roundingStep(numerator: number, denominator: number): RoundingStep {
  const quotient = intDiv(numerator, denominator);
  const resultCents = roundHalfUp(numerator, denominator);
  return {
    numerator,
    denominator,
    quotient,
    remainder: numerator - quotient * denominator,
    roundedUp: resultCents > quotient,
    resultCents,
  };
}

export function explainCharge(input: {
  limitCents: number;
  rateBps: number;
  term: Term;
  charge: ChargeEntry;
}): ChargeExplanation {
  const { limitCents, rateBps, term, charge } = input;
  const premium = roundingStep(safeMultiply(limitCents, rateBps), 10000);
  const daysInEffect = daysBetween(charge.effectiveDate, term.end);
  const inRange = daysInEffect > 0 && daysInEffect <= term.days && charge.premiumCents >= 0;
  const proration = inRange ? roundingStep(safeMultiply(charge.premiumCents, daysInEffect), term.days) : null;
  return {
    limitCents,
    rateBps,
    premium,
    termDays: term.days,
    daysInEffect,
    proration,
    storedPremiumCents: charge.premiumCents,
    storedAmountCents: charge.amountCents,
    matchesStored:
      premium.resultCents === charge.premiumCents &&
      proration !== null &&
      proration.resultCents === charge.amountCents,
  };
}
