// Effective-date correction as reverse-and-rebook. The original charge stays, a REVERSAL
// copies its amount negated (never recomputed), and a new CHARGE is computed at the
// corrected date. Freed cash is re-allocated FIFO.

import { assertIsoDate, assertTerm, daysBetween, isDateInTerm, type IsoDate, type Term } from "./dates";
import { DomainError, fail, ok, type Result } from "./errors";
import { allocateFifo } from "./allocation";
import { chargeNetOpen, findCharge, isReversed, latestInChain, nextSeq } from "./ledger";
import { chargeForEffectiveDate } from "./proration";
import { planAllocationRelease } from "./release";
import type { Allocation, ChargeEntry, LedgerState, NewId, PaymentAmount, ReversalEntry } from "./types";

export interface PlanCorrectionInput extends LedgerState {
  term: Term;
  chargeId: string;
  newEffectiveDate: IsoDate;
  /** Transaction date. */
  date: IsoDate;
  policyCancelled: boolean;
  newId: NewId;
}

export interface PlanCorrectionValue {
  reversal: ReversalEntry;
  rebook: ChargeEntry;
  /** [reversal, rebook] in posting order. */
  entries: [ReversalEntry, ChargeEntry];
  /** Negative rows taking cash off the original charge (sourceEntryId = reversal). */
  releases: Allocation[];
  /** FIFO re-allocation of unapplied cash after the rebook (sourceEntryId = rebook). */
  allocations: Allocation[];
  remainingByPayment: PaymentAmount[];
  /** rebook - original. */
  netChangeCents: number;
}

export function planCorrection(input: PlanCorrectionInput): Result<PlanCorrectionValue> {
  const term = assertTerm(input.term);
  const date = assertIsoDate(input.date, "date");
  const newEffectiveDate = assertIsoDate(input.newEffectiveDate, "newEffectiveDate");
  const { entries, allocations, payments, newId } = input;

  if (input.policyCancelled) {
    return fail("POLICY_CANCELLED", "Corrections are blocked on cancelled policies.");
  }
  const charge = findCharge(entries, input.chargeId);
  if (isReversed(entries, charge.id)) {
    return fail("CHARGE_ALREADY_REVERSED", "This charge was already reversed; correct the latest charge.", {
      chargeId: charge.id,
      latestChargeId: latestInChain(entries, charge.id).id,
    });
  }
  if (newEffectiveDate === charge.effectiveDate) {
    return fail("SAME_EFFECTIVE_DATE", "The corrected date is the same as the current one.", {
      effectiveDate: newEffectiveDate,
    });
  }
  if (!isDateInTerm(newEffectiveDate, term)) {
    return fail("EFFECTIVE_DATE_OUTSIDE_TERM", "Effective date must be within the term.", {
      effectiveDate: newEffectiveDate,
      termStart: term.start,
      termEnd: term.end,
    });
  }
  if (chargeNetOpen(charge, entries) !== charge.amountCents) {
    throw new DomainError(`charge ${charge.id} has credits; only uncredited charges can be corrected`);
  }

  const seq = nextSeq(entries);
  const reversal: ReversalEntry = {
    id: newId(),
    type: "REVERSAL",
    date,
    seq,
    amountCents: -charge.amountCents,
    reversesEntryId: charge.id,
  };
  const rebook: ChargeEntry = {
    id: newId(),
    type: "CHARGE",
    date,
    seq: seq + 1,
    amountCents: chargeForEffectiveDate(term, charge.premiumCents, newEffectiveDate),
    effectiveDate: newEffectiveDate,
    premiumCents: charge.premiumCents,
    rebookOf: charge.id,
    coverageLineId: charge.coverageLineId,
    daysInEffect: daysBetween(newEffectiveDate, term.end),
    daysInTerm: term.days,
  };

  const releases =
    charge.amountCents > 0
      ? planAllocationRelease({
          chargeId: charge.id,
          creditCents: charge.amountCents,
          entries,
          allocations,
          payments,
          sourceEntryId: reversal.id,
        }).releases
      : [];

  const fifo = allocateFifo({
    entries: [...entries, reversal, rebook],
    allocations: [...allocations, ...releases],
    payments,
    sourceEntryId: rebook.id,
  });

  return ok({
    reversal,
    rebook,
    entries: [reversal, rebook],
    releases,
    allocations: fifo.allocations,
    remainingByPayment: fifo.remainingByPayment,
    netChangeCents: rebook.amountCents + reversal.amountCents,
  });
}
