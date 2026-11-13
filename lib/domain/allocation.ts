// FIFO allocation: oldest payment's unapplied cash first, to the oldest open charge first.

import { assertIsoDate, assertTerm, daysBetween, isDateInTerm, type IsoDate, type Term } from "./dates";
import { DomainError, fail, ok, type Result } from "./errors";
import {
  byOldest,
  chargeUnpaid,
  liveCharges,
  nextSeq,
  paymentUnapplied,
} from "./ledger";
import { assertPositiveCents } from "./money";
import { chargeForEffectiveDate } from "./proration";
import type {
  Allocation,
  ChargeEntry,
  LedgerState,
  NewId,
  Payment,
  PaymentAmount,
  PaymentEntry,
} from "./types";
import { minInt } from "./int";

export interface AllocateFifoInput extends LedgerState {
  sourceEntryId: string | null;
}

export interface AllocateFifoResult {
  allocations: Allocation[];
  /** Unapplied cash left on every succeeded payment, oldest payment first. */
  remainingByPayment: PaymentAmount[];
}

/**
 * Applies all unapplied cash of succeeded payments to open (unpaid) live charges.
 * Open amount is chargeNetOpen minus cash already allocated.
 */
export function allocateFifo(input: AllocateFifoInput): AllocateFifoResult {
  const { entries, allocations, payments, sourceEntryId } = input;

  const open = liveCharges(entries)
    .map((charge) => ({ charge, left: chargeUnpaid(charge, entries, allocations) }))
    .filter((x) => {
      if (x.left < 0) throw new DomainError(`charge ${x.charge.id} holds more cash than it is owed`);
      return x.left > 0;
    })
    .sort((a, b) => byOldest(a.charge, b.charge));

  const cash = payments
    .filter((p) => p.status === "succeeded")
    .sort(byOldest)
    .map((payment) => {
      const left = paymentUnapplied(payment, entries, allocations);
      if (left < 0) throw new DomainError(`payment ${payment.id} is over-applied`);
      return { payment, left };
    });

  const out: Allocation[] = [];
  let ci = 0;
  for (const c of cash) {
    while (c.left > 0 && ci < open.length) {
      const target = open[ci]!;
      const amount = minInt(c.left, target.left);
      out.push({ paymentId: c.payment.id, chargeId: target.charge.id, amountCents: amount, sourceEntryId });
      c.left -= amount;
      target.left -= amount;
      if (target.left === 0) ci++;
    }
  }

  return {
    allocations: out,
    remainingByPayment: cash.map((c) => ({ paymentId: c.payment.id, amountCents: c.left })),
  };
}

export interface PlanPaymentInput extends LedgerState {
  /** The payment being recorded; replaces any copy of it in `payments`. */
  payment: Payment;
  date: IsoDate;
  newId: NewId;
}

export interface PlanPaymentValue {
  entries: [PaymentEntry];
  allocations: Allocation[];
  remainingByPayment: PaymentAmount[];
}

/** Records a succeeded payment and applies unapplied cash FIFO. */
export function planPaymentApplication(input: PlanPaymentInput): Result<PlanPaymentValue> {
  const { payment, entries, allocations, newId } = input;
  const date = assertIsoDate(input.date, "date");
  assertPositiveCents(payment.amountCents, "payment amountCents");
  if (payment.status !== "succeeded") {
    return fail("PAYMENT_NOT_SUCCEEDED", `Payment ${payment.id} is ${payment.status}.`, {
      paymentId: payment.id,
      status: payment.status,
    });
  }
  if (entries.some((e) => e.type === "PAYMENT" && e.paymentId === payment.id)) {
    throw new DomainError(`payment ${payment.id} is already recorded`);
  }

  const entry: PaymentEntry = {
    id: newId(),
    type: "PAYMENT",
    date,
    seq: nextSeq(entries),
    amountCents: -payment.amountCents,
    paymentId: payment.id,
  };
  const payments = [...input.payments.filter((p) => p.id !== payment.id), payment];
  const fifo = allocateFifo({ entries: [...entries, entry], allocations, payments, sourceEntryId: entry.id });
  return ok({ entries: [entry], ...fifo });
}

export interface PlanChargeInput extends LedgerState {
  term: Term;
  premiumCents: number;
  effectiveDate: IsoDate;
  coverageLineId: string | null;
  date: IsoDate;
  policyCancelled: boolean;
  newId: NewId;
}

export interface PlanChargeValue {
  entries: [ChargeEntry];
  allocations: Allocation[];
  remainingByPayment: PaymentAmount[];
}

/** A new prorated charge (policy premium or added coverage), with any credit on account applied. */
export function planCharge(input: PlanChargeInput): Result<PlanChargeValue> {
  const term = assertTerm(input.term);
  const date = assertIsoDate(input.date, "date");
  const effectiveDate = assertIsoDate(input.effectiveDate, "effectiveDate");
  assertPositiveCents(input.premiumCents, "premiumCents");
  if (input.policyCancelled) return fail("POLICY_CANCELLED", "The policy is cancelled.");
  if (!isDateInTerm(effectiveDate, term)) {
    return fail("EFFECTIVE_DATE_OUTSIDE_TERM", "Effective date must be within the term.", {
      effectiveDate,
      termStart: term.start,
      termEnd: term.end,
    });
  }

  const entry: ChargeEntry = {
    id: input.newId(),
    type: "CHARGE",
    date,
    seq: nextSeq(input.entries),
    amountCents: chargeForEffectiveDate(term, input.premiumCents, effectiveDate),
    effectiveDate,
    premiumCents: input.premiumCents,
    rebookOf: null,
    coverageLineId: input.coverageLineId,
    daysInEffect: daysBetween(effectiveDate, term.end),
    daysInTerm: term.days,
  };
  const fifo = allocateFifo({
    entries: [...input.entries, entry],
    allocations: input.allocations,
    payments: input.payments,
    sourceEntryId: entry.id,
  });
  return ok({ entries: [entry], ...fifo });
}
