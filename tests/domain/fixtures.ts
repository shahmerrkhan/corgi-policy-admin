// Shared builders for domain tests (not a test file itself).

import {
  makeTerm,
  type Allocation,
  type ChargeEntry,
  type IsoDate,
  type LedgerEntry,
  type LedgerState,
  type Payment,
  type PaymentEntry,
  type PaymentStatus,
  type Result,
  type Term,
} from "@/lib/domain";

export function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.value;
}

export function idGen(prefix = "e"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** 2026-01-01 to 2027-01-01, 365 days. */
export const TERM_2026: Term = must(makeTerm("2026-01-01"));
/** 2027-03-01 to 2028-03-01, spans Feb 29 2028, 366 days. */
export const TERM_LEAP: Term = must(makeTerm("2027-03-01"));

export function charge(
  over: Partial<ChargeEntry> & Pick<ChargeEntry, "id" | "amountCents">,
): ChargeEntry {
  return {
    type: "CHARGE",
    date: "2026-01-01",
    seq: 1,
    effectiveDate: "2026-01-01",
    premiumCents: over.amountCents,
    rebookOf: null,
    coverageLineId: null,
    ...over,
  };
}

export function payment(
  id: string,
  amountCents: number,
  date: IsoDate,
  seq: number,
  status: PaymentStatus = "succeeded",
): Payment {
  return { id, amountCents, date, seq, status };
}

export function paymentEntry(p: Payment, seq: number): PaymentEntry {
  return { id: `pe-${p.id}`, type: "PAYMENT", date: p.date, seq, amountCents: -p.amountCents, paymentId: p.id };
}

export function alloc(paymentId: string, chargeId: string, amountCents: number, sourceEntryId: string | null = null): Allocation {
  return { paymentId, chargeId, amountCents, sourceEntryId };
}

/** Applies a planner result to state, the way a service would insert rows. */
export function apply(
  state: LedgerState,
  add: { entries?: readonly LedgerEntry[]; allocations?: readonly Allocation[]; releases?: readonly Allocation[] },
): LedgerState {
  return {
    entries: [...state.entries, ...(add.entries ?? [])],
    allocations: [...state.allocations, ...(add.releases ?? []), ...(add.allocations ?? [])],
    payments: state.payments,
  };
}
