// Releasing cash from a charge when a reversal or credit reduces it.
// A credit first reduces the charge's unpaid amount; only the excess releases cash.

import { DomainError } from "./errors";
import { maxInt, minInt } from "./int";
import { byNewest, chargeNetOpen, findCharge, findPayment, netAllocatedToCharge } from "./ledger";
import { assertPositiveCents } from "./money";
import type { Allocation, LedgerState } from "./types";

export interface PlanAllocationReleaseInput extends LedgerState {
  chargeId: string;
  /** Size of the reversal or credit (positive). `entries` must not yet include it. */
  creditCents: number;
  /** The reversal or credit entry that causes the release. */
  sourceEntryId: string;
}

export interface PlanAllocationReleaseValue {
  /** Negative allocation rows, newest payment first. */
  releases: Allocation[];
  releasedCents: number;
  /** Unpaid amount of the charge before the credit. */
  unpaidBeforeCents: number;
}

export function planAllocationRelease(input: PlanAllocationReleaseInput): PlanAllocationReleaseValue {
  const { chargeId, entries, allocations, payments, sourceEntryId } = input;
  const credit = assertPositiveCents(input.creditCents, "creditCents");
  const charge = findCharge(entries, chargeId);
  const netOpen = chargeNetOpen(charge, entries);
  if (credit > netOpen) {
    throw new DomainError(`credit ${credit} exceeds charge ${chargeId} net amount ${netOpen}`);
  }

  const allocated = netAllocatedToCharge(chargeId, allocations);
  const unpaid = netOpen - allocated;
  if (allocated < 0 || unpaid < 0) {
    throw new DomainError(`charge ${chargeId} allocations ${allocated} are outside 0..${netOpen}`);
  }
  const excess = maxInt(0, credit - unpaid);
  let toRelease = minInt(excess, allocated);
  const releasedCents = toRelease;

  // Net cash each payment holds on this charge.
  const byPayment = new Map<string, number>();
  for (const a of allocations) {
    if (a.chargeId === chargeId) byPayment.set(a.paymentId, (byPayment.get(a.paymentId) ?? 0) + a.amountCents);
  }
  const holders = [...byPayment.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([paymentId, amount]) => ({ payment: findPayment(payments, paymentId), amount }))
    .sort((a, b) => byNewest(a.payment, b.payment));

  const releases: Allocation[] = [];
  for (const h of holders) {
    if (toRelease === 0) break;
    const amount = minInt(toRelease, h.amount);
    releases.push({ paymentId: h.payment.id, chargeId, amountCents: -amount, sourceEntryId });
    toRelease -= amount;
  }
  if (toRelease !== 0) throw new DomainError(`could not release ${toRelease} from charge ${chargeId}`);

  return { releases, releasedCents, unpaidBeforeCents: unpaid };
}
