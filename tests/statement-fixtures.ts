// Builds statements the same way the pages do (buildStatement), from stored-row shapes.
import type { ChargeEntry, LedgerEntry } from "@/lib/domain";
import type { PolicyListItem } from "@/lib/services/read-models";
import { buildStatement, type StatementInput } from "@/lib/services/statement-view";

export const policy: PolicyListItem = {
  id: "pol-1",
  policyNumber: "CGL-000050",
  customerId: "cust-1",
  customerName: "Maple Lane Landscaping Ltd.",
  termStart: "2026-01-01",
  termEnd: "2027-01-01",
  limitCents: 7_300_000,
  rateBps: 100,
  premiumCents: 73_000,
  status: "active",
};

export function charge(over: Partial<ChargeEntry> = {}): ChargeEntry {
  return {
    id: "c1",
    type: "CHARGE",
    date: "2026-01-01",
    seq: 1,
    amountCents: 73_000,
    effectiveDate: "2026-01-01",
    premiumCents: 73_000,
    rebookOf: null,
    coverageLineId: null,
    daysInEffect: 365,
    daysInTerm: 365,
    ...over,
  };
}

/** Charge, payment, reversal, rebook (effective 2026-06-15, 200 days: 73,000 x 200 / 365 = 40,000 r 0). */
export const correctedEntries: LedgerEntry[] = [
  charge(),
  { id: "p1", type: "PAYMENT", date: "2026-01-10", seq: 2, amountCents: -50_000, paymentId: "pay-1" },
  { id: "r1", type: "REVERSAL", date: "2026-02-01", seq: 3, amountCents: -73_000, reversesEntryId: "c1" },
  charge({ id: "c2", date: "2026-02-01", seq: 4, amountCents: 40_000, effectiveDate: "2026-06-15", rebookOf: "c1", daysInEffect: 200 }),
];

export function statementOf(entries: LedgerEntry[], over: Partial<StatementInput> = {}) {
  return buildStatement({
    policy,
    entryRows: entries.map((entry) => ({ entry, eventId: entry.type === "PAYMENT" ? "ev-pay" : "ev-issue" })),
    eventRows: [],
    lineRows: [],
    paymentRows: [{ id: "pay-1", status: "succeeded" }],
    actorNames: [],
    ...over,
  });
}
