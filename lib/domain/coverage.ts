// Adding a named coverage line to an active policy (step 8). The line has its own limit and
// rate; its full-term premium is prorated from the effective date to term end (end
// excluded) and posted as one CHARGE, with any unapplied cash applied FIFO.

import { assertIsoDate, assertTerm, daysBetween, isBackdatedOver30Days, type IsoDate, type Term } from "./dates";
import { fail, ok, type Result } from "./errors";
import { premiumCents } from "./money";
import { planCharge, type PlanChargeValue } from "./allocation";
import type { LedgerState, NewId } from "./types";

export const COVERAGE_NAME_MAX = 100;

/** The stored form of a coverage name: trimmed. */
export function normalizeCoverageName(name: string): string {
  return name.trim();
}

/** Two names clash when their keys match: trimmed and case-insensitive. */
export function coverageNameKey(name: string): string {
  return normalizeCoverageName(name).toLowerCase();
}

export interface PlanAddCoverageInput extends LedgerState {
  term: Term;
  /** Names of the coverage lines already on the policy. */
  existingNames: readonly string[];
  name: string;
  /** Id for the new coverage line (the request id). */
  coverageLineId: string;
  limitCents: number;
  rateBps: number;
  effectiveDate: IsoDate;
  /** Transaction (posting) date. */
  date: IsoDate;
  policyCancelled: boolean;
  newId: NewId;
}

export interface PlanAddCoverageValue extends PlanChargeValue {
  name: string;
  /** The line's full-term premium. */
  premiumCents: number;
  daysInEffect: number;
  daysInTerm: number;
  /** The effective date is more than 30 days before the transaction date. */
  backdatedOver30Days: boolean;
}

export function planAddCoverage(input: PlanAddCoverageInput): Result<PlanAddCoverageValue> {
  const term = assertTerm(input.term);
  const date = assertIsoDate(input.date, "date");
  const effectiveDate = assertIsoDate(input.effectiveDate, "effectiveDate");
  const name = normalizeCoverageName(input.name);

  if (input.policyCancelled) return fail("POLICY_CANCELLED", "The policy is cancelled.");
  if (name === "" || name.length > COVERAGE_NAME_MAX) {
    return fail("INVALID_COVERAGE_NAME", `Coverage name is required, at most ${COVERAGE_NAME_MAX} characters.`);
  }
  const key = coverageNameKey(name);
  if (input.existingNames.some((n) => coverageNameKey(n) === key)) {
    return fail("DUPLICATE_COVERAGE_NAME", "This policy already has a coverage with that name.", { name });
  }

  const premium = premiumCents(input.limitCents, input.rateBps);
  const plan = planCharge({
    term,
    premiumCents: premium,
    effectiveDate,
    coverageLineId: input.coverageLineId,
    date,
    policyCancelled: false,
    newId: input.newId,
    entries: input.entries,
    allocations: input.allocations,
    payments: input.payments,
  });
  if (!plan.ok) return plan;

  return ok({
    ...plan.value,
    name,
    premiumCents: premium,
    daysInEffect: daysBetween(effectiveDate, term.end),
    daysInTerm: term.days,
    backdatedOver30Days: isBackdatedOver30Days(effectiveDate, date),
  });
}
