// Rows <-> exact lib/domain types. lib/domain never sees DB-only columns
// (policy_id, event_id, stripe ids, timestamps); services pass those in as context.
import {
  assertTerm,
  daysBetween,
  type Allocation,
  type LedgerEntry,
  type Payment,
  type Term,
} from "@/lib/domain";
import type {
  LedgerEntryRow,
  NewLedgerEntryRow,
  NewPaymentAllocationRow,
  PaymentAllocationRow,
  PaymentRow,
  PolicyRow,
} from "./schema";

function need<T>(value: T | null | undefined, column: string, row: { id: string }): T {
  if (value === null || value === undefined) {
    throw new Error(`ledger_entries ${row.id}: ${column} is null`);
  }
  return value;
}

export function termFromPolicy(row: Pick<PolicyRow, "termStart" | "termEnd">): Term {
  return assertTerm({ start: row.termStart, end: row.termEnd, days: daysBetween(row.termStart, row.termEnd) });
}

export function entryFromRow(row: LedgerEntryRow): LedgerEntry {
  const base = { id: row.id, date: row.date, seq: row.seq, amountCents: row.amountCents };
  switch (row.type) {
    case "CHARGE":
      return {
        ...base,
        type: "CHARGE",
        effectiveDate: need(row.effectiveDate, "effective_date", row),
        premiumCents: need(row.premiumCents, "premium_cents", row),
        rebookOf: row.rebookOf,
        coverageLineId: row.coverageLineId,
        daysInEffect: row.daysInEffect,
        daysInTerm: row.daysInTerm,
      };
    case "REVERSAL":
      return { ...base, type: "REVERSAL", reversesEntryId: need(row.reversesEntryId, "reverses_entry_id", row) };
    case "CREDIT":
      return {
        ...base,
        type: "CREDIT",
        chargeId: need(row.chargeId, "charge_id", row),
        effectiveDate: need(row.effectiveDate, "effective_date", row),
      };
    case "PAYMENT":
      return { ...base, type: "PAYMENT", paymentId: need(row.paymentId, "payment_id", row) };
    case "REFUND":
      return { ...base, type: "REFUND", paymentId: need(row.paymentId, "payment_id", row) };
  }
}

export interface EntryContext {
  policyId: string;
  eventId: string;
  /** Required for REFUND entries, forbidden for every other type. */
  stripeRefundId?: string;
}

export function entryToRow(entry: LedgerEntry, ctx: EntryContext): NewLedgerEntryRow {
  if (entry.type === "REFUND" && !ctx.stripeRefundId) {
    throw new Error(`REFUND entry ${entry.id} needs a stripeRefundId`);
  }
  if (entry.type !== "REFUND" && ctx.stripeRefundId !== undefined) {
    throw new Error(`${entry.type} entry ${entry.id} must not have a stripeRefundId`);
  }
  const row: NewLedgerEntryRow = {
    id: entry.id,
    policyId: ctx.policyId,
    eventId: ctx.eventId,
    type: entry.type,
    date: entry.date,
    seq: entry.seq,
    amountCents: entry.amountCents,
    effectiveDate: null,
    premiumCents: null,
    daysInEffect: null,
    daysInTerm: null,
    rebookOf: null,
    coverageLineId: null,
    reversesEntryId: null,
    chargeId: null,
    paymentId: null,
    stripeRefundId: null,
  };
  switch (entry.type) {
    case "CHARGE":
      return {
        ...row,
        effectiveDate: entry.effectiveDate,
        premiumCents: entry.premiumCents,
        rebookOf: entry.rebookOf,
        coverageLineId: entry.coverageLineId,
        daysInEffect: entry.daysInEffect,
        daysInTerm: entry.daysInTerm,
      };
    case "REVERSAL":
      return { ...row, reversesEntryId: entry.reversesEntryId };
    case "CREDIT":
      return { ...row, chargeId: entry.chargeId, effectiveDate: entry.effectiveDate };
    case "PAYMENT":
      return { ...row, paymentId: entry.paymentId };
    case "REFUND":
      return { ...row, paymentId: entry.paymentId, stripeRefundId: ctx.stripeRefundId ?? null };
  }
}

export function paymentFromRow(row: PaymentRow): Payment {
  return { id: row.id, date: row.date, seq: row.seq, amountCents: row.amountCents, status: row.status };
}

export function allocationFromRow(row: PaymentAllocationRow): Allocation {
  return {
    paymentId: row.paymentId,
    chargeId: row.chargeId,
    amountCents: row.amountCents,
    sourceEntryId: row.sourceEntryId,
  };
}

export function allocationToRow(
  allocation: Allocation,
  ctx: { policyId: string; eventId: string },
): NewPaymentAllocationRow {
  return {
    policyId: ctx.policyId,
    eventId: ctx.eventId,
    paymentId: allocation.paymentId,
    chargeId: allocation.chargeId,
    amountCents: allocation.amountCents,
    sourceEntryId: allocation.sourceEntryId,
  };
}
