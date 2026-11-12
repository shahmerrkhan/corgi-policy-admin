// Refunds come only from unapplied cash on succeeded payments, newest payment first.

import { assertIsoDate, type IsoDate } from "./dates";
import { fail, ok, type Result } from "./errors";
import { minInt } from "./int";
import { byNewest, nextSeq, paymentUnapplied } from "./ledger";
import { assertPositiveCents } from "./money";
import type { LedgerState, NewId, PaymentAmount, RefundEntry } from "./types";

/** Refundable cash per succeeded payment (only those with some), newest payment first. */
export function refundableByPayment(state: LedgerState): PaymentAmount[] {
  return state.payments
    .filter((p) => p.status === "succeeded")
    .sort(byNewest)
    .map((p) => ({ paymentId: p.id, amountCents: paymentUnapplied(p, state.entries, state.allocations) }))
    .filter((x) => x.amountCents > 0);
}

export function totalRefundable(state: LedgerState): number {
  let sum = 0;
  for (const x of refundableByPayment(state)) sum += x.amountCents;
  return sum;
}

/** Splits an amount across payments newest first, without building entries. */
export function splitRefund(state: LedgerState, amountCents: number): PaymentAmount[] {
  let left = amountCents;
  const out: PaymentAmount[] = [];
  for (const x of refundableByPayment(state)) {
    if (left === 0) break;
    const amount = minInt(left, x.amountCents);
    out.push({ paymentId: x.paymentId, amountCents: amount });
    left -= amount;
  }
  return out;
}

export interface PlanRefundInput extends LedgerState {
  amountCents: number;
  date: IsoDate;
  newId: NewId;
}

export interface PlanRefundValue {
  /** One REFUND entry per payment refunded, newest payment first. */
  entries: RefundEntry[];
  byPayment: PaymentAmount[];
  totalCents: number;
}

export function planRefund(input: PlanRefundInput): Result<PlanRefundValue> {
  const amount = assertPositiveCents(input.amountCents, "refund amountCents");
  const date = assertIsoDate(input.date, "date");
  const available = totalRefundable(input);
  if (amount > available) {
    return fail("NOT_ENOUGH_REFUNDABLE_CASH", "The refund is more than the refundable cash.", {
      requestedCents: amount,
      refundableCents: available,
    });
  }
  const byPayment = splitRefund(input, amount);
  let seq = nextSeq(input.entries);
  const entries: RefundEntry[] = byPayment.map((x) => ({
    id: input.newId(),
    type: "REFUND",
    date,
    seq: seq++,
    amountCents: x.amountCents,
    paymentId: x.paymentId,
  }));
  return ok({ entries, byPayment, totalCents: amount });
}
