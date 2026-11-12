import type { IsoDate } from "./dates";

// Sign convention: the sum of all entries is the account balance.
// CHARGE +, REVERSAL - (exact negation of the charge), CREDIT -, PAYMENT -, REFUND +.
// A negative balance is credit on account.

export type EntryType = "CHARGE" | "REVERSAL" | "CREDIT" | "PAYMENT" | "REFUND";

interface EntryBase {
  id: string;
  /** Transaction (posting) date. */
  date: IsoDate;
  /** Stable order for entries on the same date. */
  seq: number;
  amountCents: number;
}

export interface ChargeEntry extends EntryBase {
  type: "CHARGE";
  effectiveDate: IsoDate;
  /** P: the line's full-term premium this charge was prorated from. */
  premiumCents: number;
  /** The reversed charge this one re-books, or null for an original charge. */
  rebookOf: string | null;
  coverageLineId: string | null;
}

export interface ReversalEntry extends EntryBase {
  type: "REVERSAL";
  reversesEntryId: string;
}

export interface CreditEntry extends EntryBase {
  type: "CREDIT";
  chargeId: string;
  /** The cancellation date the credit was computed from. */
  effectiveDate: IsoDate;
}

export interface PaymentEntry extends EntryBase {
  type: "PAYMENT";
  paymentId: string;
}

export interface RefundEntry extends EntryBase {
  type: "REFUND";
  paymentId: string;
}

export type LedgerEntry = ChargeEntry | ReversalEntry | CreditEntry | PaymentEntry | RefundEntry;

export type PaymentStatus = "pending" | "succeeded" | "failed";

export interface Payment {
  id: string;
  date: IsoDate;
  seq: number;
  amountCents: number;
  status: PaymentStatus;
}

/**
 * One payment_allocations row. Positive applies cash to a charge; negative is a release.
 * sourceEntryId is the ledger entry that caused the row: always set on releases (the
 * reversal or credit), the PAYMENT or new CHARGE entry for FIFO rows, null for the
 * re-allocation that closes a cancellation.
 */
export interface Allocation {
  paymentId: string;
  chargeId: string;
  amountCents: number;
  sourceEntryId: string | null;
}

export interface PaymentAmount {
  paymentId: string;
  amountCents: number;
}

/** Ledger state a planner works from. */
export interface LedgerState {
  entries: readonly LedgerEntry[];
  allocations: readonly Allocation[];
  payments: readonly Payment[];
}

/** Supplies ids for new entries (crypto.randomUUID in services, a counter in tests). */
export type NewId = () => string;
