// Whole-ledger checks. checkInvariants returns every violation; assertInvariants throws.

import { DomainError } from "./errors";
import {
  chargeNetOpen,
  charges,
  netAllocatedFromPayment,
  netAllocatedToCharge,
  refundedFromPayment,
} from "./ledger";
import { maxInt } from "./int";
import type { ChargeEntry, LedgerState, Payment } from "./types";

export interface CashConservation {
  paymentsCents: number;
  allocatedCents: number;
  unappliedCents: number;
  refundedCents: number;
}

/** Totals over succeeded payments. Holds when paymentsCents = allocated + unapplied + refunded. */
export function cashConservation(state: LedgerState): CashConservation {
  let paymentsCents = 0;
  let allocatedCents = 0;
  let unappliedCents = 0;
  let refundedCents = 0;
  for (const p of state.payments) {
    if (p.status !== "succeeded") continue;
    const allocated = netAllocatedFromPayment(p.id, state.allocations);
    const refunded = refundedFromPayment(p.id, state.entries);
    paymentsCents += p.amountCents;
    allocatedCents += allocated;
    refundedCents += refunded;
    // Clamped, so an over-applied payment breaks the equation instead of hiding in it.
    unappliedCents += maxInt(0, p.amountCents - allocated - refunded);
  }
  return { paymentsCents, allocatedCents, unappliedCents, refundedCents };
}

export function checkInvariants(state: LedgerState): string[] {
  const { entries, allocations, payments } = state;
  const v: string[] = [];

  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) v.push(`duplicate entry id ${e.id}`);
    ids.add(e.id);
    if (!Number.isSafeInteger(e.amountCents)) v.push(`entry ${e.id} amount is not integer cents`);
  }

  const chargeById = new Map<string, ChargeEntry>(charges(entries).map((c) => [c.id, c]));
  const paymentById = new Map<string, Payment>(payments.map((p) => [p.id, p]));
  const reversalCount = new Map<string, number>();
  const paymentEntryCount = new Map<string, number>();

  for (const e of entries) {
    switch (e.type) {
      case "CHARGE":
        if (e.amountCents < 0) v.push(`charge ${e.id} is negative`);
        if (e.rebookOf !== null) {
          const orig = chargeById.get(e.rebookOf);
          if (!orig) v.push(`rebook ${e.id} points to missing charge ${e.rebookOf}`);
          else if (!entries.some((x) => x.type === "REVERSAL" && x.reversesEntryId === orig.id)) {
            v.push(`rebook ${e.id} re-books charge ${orig.id}, which is not reversed`);
          }
        }
        break;
      case "REVERSAL": {
        const orig = chargeById.get(e.reversesEntryId);
        if (!orig) v.push(`reversal ${e.id} points to missing charge ${e.reversesEntryId}`);
        else if (e.amountCents !== -orig.amountCents) {
          v.push(`reversal ${e.id} is ${e.amountCents}, not exactly -${orig.amountCents}`);
        }
        reversalCount.set(e.reversesEntryId, (reversalCount.get(e.reversesEntryId) ?? 0) + 1);
        break;
      }
      case "CREDIT":
        if (!chargeById.has(e.chargeId)) v.push(`credit ${e.id} points to missing charge ${e.chargeId}`);
        if (e.amountCents >= 0) v.push(`credit ${e.id} must be negative`);
        break;
      case "PAYMENT": {
        const p = paymentById.get(e.paymentId);
        if (!p) v.push(`payment entry ${e.id} points to missing payment ${e.paymentId}`);
        else {
          if (p.status !== "succeeded") v.push(`payment entry ${e.id} is for a ${p.status} payment`);
          if (e.amountCents !== -p.amountCents) v.push(`payment entry ${e.id} does not equal -${p.amountCents}`);
        }
        paymentEntryCount.set(e.paymentId, (paymentEntryCount.get(e.paymentId) ?? 0) + 1);
        break;
      }
      case "REFUND": {
        const p = paymentById.get(e.paymentId);
        if (!p) v.push(`refund ${e.id} points to missing payment ${e.paymentId}`);
        else if (p.status !== "succeeded") v.push(`refund ${e.id} is from a ${p.status} payment`);
        if (e.amountCents <= 0) v.push(`refund ${e.id} must be positive`);
        break;
      }
    }
  }

  for (const [chargeId, n] of reversalCount) {
    if (n > 1) v.push(`charge ${chargeId} is reversed ${n} times`);
  }

  for (const a of allocations) {
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents === 0) {
      v.push(`allocation ${a.paymentId}->${a.chargeId} amount ${a.amountCents} is not non-zero integer cents`);
    }
    if (!chargeById.has(a.chargeId)) v.push(`allocation to missing charge ${a.chargeId}`);
    const p = paymentById.get(a.paymentId);
    if (!p) v.push(`allocation from missing payment ${a.paymentId}`);
    else if (p.status !== "succeeded") v.push(`allocation from ${p.status} payment ${p.id}`);
  }

  // A release can never take back more than that payment gave that charge.
  const pair = new Map<string, number>();
  for (const a of allocations) {
    const k = `${a.paymentId}|${a.chargeId}`;
    pair.set(k, (pair.get(k) ?? 0) + a.amountCents);
  }
  for (const [k, net] of pair) {
    if (net < 0) v.push(`payment|charge ${k} net allocation ${net} is negative`);
  }

  for (const c of chargeById.values()) {
    const netOpen = chargeNetOpen(c, entries);
    const allocated = netAllocatedToCharge(c.id, allocations);
    if (netOpen < 0) v.push(`charge ${c.id} net amount ${netOpen} is negative`);
    if (allocated < 0 || allocated > netOpen) {
      v.push(`charge ${c.id} net allocations ${allocated} outside 0..${netOpen}`);
    }
  }

  for (const p of payments) {
    const allocated = netAllocatedFromPayment(p.id, allocations);
    const refunded = refundedFromPayment(p.id, entries);
    const used = allocated + refunded;
    if (used < 0 || used > p.amountCents) {
      v.push(`payment ${p.id} allocations + refunds ${used} outside 0..${p.amountCents}`);
    }
    if (p.status === "succeeded" && (paymentEntryCount.get(p.id) ?? 0) !== 1) {
      v.push(`succeeded payment ${p.id} needs exactly one PAYMENT entry`);
    }
  }

  const cc = cashConservation(state);
  if (cc.paymentsCents !== cc.allocatedCents + cc.unappliedCents + cc.refundedCents) {
    v.push(
      `cash not conserved: payments ${cc.paymentsCents} != allocated ${cc.allocatedCents} + unapplied ${cc.unappliedCents} + refunded ${cc.refundedCents}`,
    );
  }

  return v;
}

export function assertInvariants(state: LedgerState): void {
  const v = checkInvariants(state);
  if (v.length > 0) throw new DomainError(`ledger invariants violated:\n- ${v.join("\n- ")}`);
}
