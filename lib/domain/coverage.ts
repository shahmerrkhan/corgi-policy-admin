// Adding a named coverage line to an active policy (step 8). The line has its own limit and
// rate; its full-term premium is prorated from the effective date to term end (end
// excluded) and posted as one CHARGE, with any unapplied cash applied FIFO.

import {
  assertIsoDate,
  assertTerm,
  compareIsoDate,
  daysBetween,
  isBackdatedOver30Days,
  type IsoDate,
  type Term,
} from "./dates";
import { DomainError, fail, ok, type Result } from "./errors";
import { premiumCents } from "./money";
import { planCharge, type PlanChargeValue } from "./allocation";
import { planCorrection, type PlanCorrectionValue } from "./correction";
import { balanceCents, charges, findCharge, isReversed } from "./ledger";
import type { ChargeEntry, LedgerEntry, LedgerState, NewId } from "./types";

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

// ---------------------------------------------------------------------------------------
// Correcting a coverage line's effective date (step 9): reverse-and-rebook its live charge.
// A line's current effective date is the effectiveDate of its one live (unreversed) charge;
// nothing on coverage_lines is ever updated.

export const CORRECTION_REASON_MAX = 500;

/** The line's one live (unreversed) CHARGE. Throws if there is none or more than one. */
export function liveChargeForLine(entries: readonly LedgerEntry[], coverageLineId: string): ChargeEntry {
  const live = charges(entries).filter((c) => c.coverageLineId === coverageLineId && !isReversed(entries, c.id));
  if (live.length !== 1) {
    throw new DomainError(`coverage line ${coverageLineId} has ${live.length} live charges, expected 1`);
  }
  return live[0]!;
}

/** Newest posting date on the ledger, or null when it is empty. */
export function latestEntryDate(entries: readonly LedgerEntry[]): IsoDate | null {
  let latest: IsoDate | null = null;
  for (const e of entries) if (latest === null || compareIsoDate(e.date, latest) > 0) latest = e.date;
  return latest;
}

export interface PlanCoverageCorrectionInput extends LedgerState {
  term: Term;
  coverageLineId: string;
  /** The live charge the review page showed. A stale id returns CHARGE_ALREADY_REVERSED. */
  expectedChargeId: string;
  newEffectiveDate: IsoDate;
  /** Transaction (posting) date of the reversal and the rebook. */
  date: IsoDate;
  reason: string;
  policyCancelled: boolean;
  newId: NewId;
}

export interface PlanCoverageCorrectionValue extends PlanCorrectionValue {
  /** The charge being reversed. */
  original: ChargeEntry;
  reason: string;
  oldDaysInEffect: number;
  newDaysInEffect: number;
  daysInTerm: number;
  /** The new effective date is more than 30 days before the transaction date. */
  backdatedOver30Days: boolean;
  balanceBeforeCents: number;
  balanceAfterCents: number;
}

export function planCoverageCorrection(input: PlanCoverageCorrectionInput): Result<PlanCoverageCorrectionValue> {
  const term = assertTerm(input.term);
  const date = assertIsoDate(input.date, "date");
  const newEffectiveDate = assertIsoDate(input.newEffectiveDate, "newEffectiveDate");
  const reason = input.reason.trim();
  if (reason === "") return fail("REASON_REQUIRED", "A reason is required.");
  if (reason.length > CORRECTION_REASON_MAX) {
    return fail("REASON_TOO_LONG", `Reason must be at most ${CORRECTION_REASON_MAX} characters.`);
  }

  const original = findCharge(input.entries, input.expectedChargeId);
  if (original.coverageLineId !== input.coverageLineId) {
    return fail("LINE_MISMATCH", "That charge does not belong to this coverage line.");
  }
  const latest = latestEntryDate(input.entries);
  if (latest !== null && compareIsoDate(date, latest) < 0) {
    return fail("TRANSACTION_DATE_TOO_EARLY", `Transaction date must be on or after ${latest}, the latest ledger entry.`, {
      latestEntryDate: latest,
    });
  }

  const plan = planCorrection({
    entries: input.entries,
    allocations: input.allocations,
    payments: input.payments,
    term,
    chargeId: original.id,
    newEffectiveDate,
    date,
    policyCancelled: input.policyCancelled,
    newId: input.newId,
  });
  if (!plan.ok) return plan;

  const before = balanceCents(input.entries);
  return ok({
    ...plan.value,
    original,
    reason,
    oldDaysInEffect: daysBetween(original.effectiveDate, term.end),
    newDaysInEffect: daysBetween(newEffectiveDate, term.end),
    daysInTerm: term.days,
    backdatedOver30Days: isBackdatedOver30Days(newEffectiveDate, date),
    balanceBeforeCents: before,
    balanceAfterCents: before + plan.value.netChangeCents,
  });
}
