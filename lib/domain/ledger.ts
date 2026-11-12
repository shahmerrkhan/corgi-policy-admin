// Read helpers over ledger state. Every cap on a charge goes through chargeNetOpen.

import { compareIsoDate } from "./dates";
import { DomainError } from "./errors";
import type {
  Allocation,
  ChargeEntry,
  CreditEntry,
  LedgerEntry,
  Payment,
  RefundEntry,
  ReversalEntry,
} from "./types";

interface Ordered {
  date: string;
  seq: number;
}

/** Oldest first: date, then seq. */
export function byOldest(a: Ordered, b: Ordered): number {
  return compareIsoDate(a.date, b.date) || a.seq - b.seq;
}

/** Newest first: date, then seq, both descending. */
export function byNewest(a: Ordered, b: Ordered): number {
  return byOldest(b, a);
}

export function charges(entries: readonly LedgerEntry[]): ChargeEntry[] {
  return entries.filter((e): e is ChargeEntry => e.type === "CHARGE");
}

export function findCharge(entries: readonly LedgerEntry[], chargeId: string): ChargeEntry {
  const c = entries.find((e) => e.id === chargeId);
  if (!c || c.type !== "CHARGE") throw new DomainError(`charge ${chargeId} not found`);
  return c;
}

export function reversalsOf(entries: readonly LedgerEntry[], chargeId: string): ReversalEntry[] {
  return entries.filter(
    (e): e is ReversalEntry => e.type === "REVERSAL" && e.reversesEntryId === chargeId,
  );
}

export function creditsOf(entries: readonly LedgerEntry[], chargeId: string): CreditEntry[] {
  return entries.filter((e): e is CreditEntry => e.type === "CREDIT" && e.chargeId === chargeId);
}

export function isReversed(entries: readonly LedgerEntry[], chargeId: string): boolean {
  return reversalsOf(entries, chargeId).length > 0;
}

/** Charges that have not been reversed, oldest first. */
export function liveCharges(entries: readonly LedgerEntry[]): ChargeEntry[] {
  return charges(entries)
    .filter((c) => !isReversed(entries, c.id))
    .sort(byOldest);
}

/**
 * The charge's amount net of its reversal and credits: the most cash it may hold.
 * Used by the release planner, allocateFifo and the invariants.
 */
export function chargeNetOpen(charge: ChargeEntry, entries: readonly LedgerEntry[]): number {
  let net = charge.amountCents;
  for (const r of reversalsOf(entries, charge.id)) net += r.amountCents;
  for (const c of creditsOf(entries, charge.id)) net += c.amountCents;
  return net;
}

export function netAllocatedToCharge(chargeId: string, allocations: readonly Allocation[]): number {
  let sum = 0;
  for (const a of allocations) if (a.chargeId === chargeId) sum += a.amountCents;
  return sum;
}

/** Unpaid part of a charge: chargeNetOpen minus cash allocated to it. */
export function chargeUnpaid(
  charge: ChargeEntry,
  entries: readonly LedgerEntry[],
  allocations: readonly Allocation[],
): number {
  return chargeNetOpen(charge, entries) - netAllocatedToCharge(charge.id, allocations);
}

export function netAllocatedFromPayment(paymentId: string, allocations: readonly Allocation[]): number {
  let sum = 0;
  for (const a of allocations) if (a.paymentId === paymentId) sum += a.amountCents;
  return sum;
}

export function refundedFromPayment(paymentId: string, entries: readonly LedgerEntry[]): number {
  let sum = 0;
  for (const e of entries) {
    if (e.type === "REFUND" && (e as RefundEntry).paymentId === paymentId) sum += e.amountCents;
  }
  return sum;
}

/**
 * Unapplied (refundable) cash on a payment: amount - net allocations - refunded.
 * Only succeeded payments hold cash; any other status has 0.
 */
export function paymentUnapplied(
  payment: Payment,
  entries: readonly LedgerEntry[],
  allocations: readonly Allocation[],
): number {
  if (payment.status !== "succeeded") return 0;
  return (
    payment.amountCents -
    netAllocatedFromPayment(payment.id, allocations) -
    refundedFromPayment(payment.id, entries)
  );
}

/** Follows rebookOf links from a charge to the newest charge in its correction chain. */
export function latestInChain(entries: readonly LedgerEntry[], chargeId: string): ChargeEntry {
  let current = findCharge(entries, chargeId);
  const seen = new Set<string>([current.id]);
  for (;;) {
    const id: string = current.id;
    const next = charges(entries).find((c) => c.rebookOf === id);
    if (!next) return current;
    if (seen.has(next.id)) throw new DomainError(`rebook chain loops at ${next.id}`);
    seen.add(next.id);
    current = next;
  }
}

export function balanceCents(entries: readonly LedgerEntry[]): number {
  let sum = 0;
  for (const e of entries) sum += e.amountCents;
  return sum;
}

/** Next seq after every existing entry. */
export function nextSeq(entries: readonly LedgerEntry[]): number {
  let max = 0;
  for (const e of entries) if (e.seq > max) max = e.seq;
  return max + 1;
}

export function findPayment(payments: readonly Payment[], paymentId: string): Payment {
  const p = payments.find((x) => x.id === paymentId);
  if (!p) throw new DomainError(`payment ${paymentId} not found`);
  return p;
}
