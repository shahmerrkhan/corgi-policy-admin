// Pro rata cancellation, no fee. For each live charge:
//   credit = charged - round_half_up(P x days_used / days_in_term)
// where P is the line's full-term premium and days_used counts from that charge's own
// effective date to the cancel date. earned + credit always equals charged.
// A charge effective on or after the cancel date is credited in full.

import {
  assertIsoDate,
  assertTerm,
  compareIsoDate,
  daysBetween,
  isBackdatedOver30Days,
  isDateInTerm,
  type IsoDate,
  type Term,
} from "./dates";
import { DomainError, fail, ok, type Result } from "./errors";
import { allocateFifo } from "./allocation";
import { chargeNetOpen, liveCharges, nextSeq } from "./ledger";
import { prorate } from "./proration";
import { planAllocationRelease } from "./release";
import { splitRefund, totalRefundable } from "./refund";
import type { Allocation, ChargeEntry, CreditEntry, LedgerEntry, LedgerState, NewId, PaymentAmount } from "./types";

/** Earned and credit for one charge at a cancel date. */
export function cancellationCredit(
  charge: ChargeEntry,
  term: Term,
  cancelDate: IsoDate,
): { earnedCents: number; creditCents: number } {
  assertTerm(term);
  assertIsoDate(cancelDate, "cancelDate");
  if (compareIsoDate(charge.effectiveDate, cancelDate) >= 0) {
    return { earnedCents: 0, creditCents: charge.amountCents };
  }
  const earned = prorate(charge.premiumCents, daysBetween(charge.effectiveDate, cancelDate), term.days);
  const credit = charge.amountCents - earned;
  if (credit < 0) {
    throw new DomainError(`charge ${charge.id} earned ${earned} exceeds its amount ${charge.amountCents}`);
  }
  return { earnedCents: earned, creditCents: credit };
}

export interface PlanCancellationInput extends LedgerState {
  term: Term;
  cancelDate: IsoDate;
  /** Transaction date ("today" for the backdating warning). */
  date: IsoDate;
  reason: string;
  policyCancelled: boolean;
  newId: NewId;
}

export interface PlanCancellationValue {
  /** CREDIT entries, oldest charge first. */
  credits: CreditEntry[];
  entries: CreditEntry[];
  /** Sum of credits (positive). */
  returnPremiumCents: number;
  /** Negative rows, each with sourceEntryId = its credit. */
  releases: Allocation[];
  /** FIFO re-allocation of unapplied cash to charges still unpaid (sourceEntryId null). */
  allocations: Allocation[];
  remainingByPayment: PaymentAmount[];
  /** All refundable cash after the cancellation, split newest payment first. */
  refundPreview: { totalCents: number; byPayment: PaymentAmount[] };
  warnings: { backdatedOver30Days: boolean };
}

export function planCancellation(input: PlanCancellationInput): Result<PlanCancellationValue> {
  const term = assertTerm(input.term);
  const date = assertIsoDate(input.date, "date");
  const cancelDate = assertIsoDate(input.cancelDate, "cancelDate");
  const { payments, newId } = input;

  if (input.policyCancelled) return fail("POLICY_CANCELLED", "The policy is already cancelled.");
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    return fail("REASON_REQUIRED", "A cancellation reason is required.");
  }
  if (!isDateInTerm(cancelDate, term)) {
    return fail("CANCEL_DATE_OUTSIDE_TERM", "Cancellation date must be within the term.", {
      cancelDate,
      termStart: term.start,
      termEnd: term.end,
    });
  }

  let entries: LedgerEntry[] = [...input.entries];
  let allocations: Allocation[] = [...input.allocations];
  const credits: CreditEntry[] = [];
  const releases: Allocation[] = [];
  let seq = nextSeq(entries);
  let returnPremiumCents = 0;

  for (const charge of liveCharges(input.entries)) {
    if (chargeNetOpen(charge, entries) !== charge.amountCents) {
      throw new DomainError(`charge ${charge.id} already has credits`);
    }
    const { creditCents } = cancellationCredit(charge, term, cancelDate);
    if (creditCents === 0) continue;
    const credit: CreditEntry = {
      id: newId(),
      type: "CREDIT",
      date,
      seq: seq++,
      amountCents: -creditCents,
      chargeId: charge.id,
      effectiveDate: cancelDate,
    };
    const rel = planAllocationRelease({
      chargeId: charge.id,
      creditCents,
      entries,
      allocations,
      payments,
      sourceEntryId: credit.id,
    });
    credits.push(credit);
    releases.push(...rel.releases);
    entries = [...entries, credit];
    allocations = [...allocations, ...rel.releases];
    returnPremiumCents += creditCents;
  }

  const fifo = allocateFifo({ entries, allocations, payments, sourceEntryId: null });
  const after = { entries, allocations: [...allocations, ...fifo.allocations], payments };
  const refundTotal = totalRefundable(after);

  return ok({
    credits,
    entries: credits,
    returnPremiumCents,
    releases,
    allocations: fifo.allocations,
    remainingByPayment: fifo.remainingByPayment,
    refundPreview: { totalCents: refundTotal, byPayment: splitRefund(after, refundTotal) },
    warnings: { backdatedOver30Days: isBackdatedOver30Days(cancelDate, date) },
  });
}
