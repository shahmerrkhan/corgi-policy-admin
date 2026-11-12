import { describe, expect, it } from "vitest";
import type { Allocation, LedgerEntry } from "@/lib/domain";
import {
  allocationFromRow,
  allocationToRow,
  entryFromRow,
  entryToRow,
  paymentFromRow,
  termFromPolicy,
} from "@/lib/db/mappers";
import type { LedgerEntryRow, PaymentAllocationRow, PaymentRow } from "@/lib/db/schema";

const ctx = { policyId: "pol-1", eventId: "evt-1" };
const createdAt = new Date("2026-01-01T00:00:00Z");

function asRow(entry: LedgerEntry, stripeRefundId?: string): LedgerEntryRow {
  const row = entryToRow(entry, stripeRefundId ? { ...ctx, stripeRefundId } : ctx);
  return { ...row, id: entry.id, createdAt } as LedgerEntryRow;
}

const entries: LedgerEntry[] = [
  {
    id: "c1",
    type: "CHARGE",
    date: "2026-01-01",
    seq: 1,
    amountCents: 73000,
    effectiveDate: "2026-01-01",
    premiumCents: 73000,
    rebookOf: null,
    coverageLineId: null,
  },
  {
    id: "c2",
    type: "CHARGE",
    date: "2026-02-01",
    seq: 3,
    amountCents: 61200,
    effectiveDate: "2026-03-01",
    premiumCents: 73000,
    rebookOf: "c1",
    coverageLineId: "line-1",
  },
  { id: "r1", type: "REVERSAL", date: "2026-02-01", seq: 2, amountCents: -73000, reversesEntryId: "c1" },
  { id: "cr1", type: "CREDIT", date: "2026-06-01", seq: 4, amountCents: -30000, chargeId: "c2", effectiveDate: "2026-06-01" },
  { id: "p1", type: "PAYMENT", date: "2026-01-05", seq: 5, amountCents: -73000, paymentId: "pay-1" },
];

describe("ledger entry mapping", () => {
  it.each(entries.map((e) => [e.type, e] as const))("round-trips a %s entry exactly", (_type, entry) => {
    expect(entryFromRow(asRow(entry))).toStrictEqual(entry);
  });

  it("round-trips a REFUND entry and stores its Stripe refund id", () => {
    const refund: LedgerEntry = { id: "rf1", type: "REFUND", date: "2026-06-02", seq: 6, amountCents: 5000, paymentId: "pay-1" };
    const row = asRow(refund, "re_123");
    expect(row.stripeRefundId).toBe("re_123");
    expect(entryFromRow(row)).toStrictEqual(refund);
  });

  it("sets only the columns a type owns", () => {
    const row = entryToRow(entries[2]!, ctx);
    expect(row).toMatchObject({
      type: "REVERSAL",
      reversesEntryId: "c1",
      effectiveDate: null,
      premiumCents: null,
      rebookOf: null,
      coverageLineId: null,
      chargeId: null,
      paymentId: null,
      stripeRefundId: null,
      policyId: "pol-1",
      eventId: "evt-1",
    });
  });

  it("requires a Stripe refund id on REFUND and forbids it elsewhere", () => {
    const refund: LedgerEntry = { id: "rf1", type: "REFUND", date: "2026-06-02", seq: 6, amountCents: 5000, paymentId: "pay-1" };
    expect(() => entryToRow(refund, ctx)).toThrow(/needs a stripeRefundId/);
    expect(() => entryToRow(entries[4]!, { ...ctx, stripeRefundId: "re_1" })).toThrow(/must not have/);
  });

  it("throws when a row is missing a column its type needs", () => {
    const row = { ...asRow(entries[0]!), premiumCents: null };
    expect(() => entryFromRow(row)).toThrow(/premium_cents is null/);
  });
});

describe("payment and allocation mapping", () => {
  it("maps a payment row to the domain Payment", () => {
    const row: PaymentRow = {
      id: "pay-1",
      policyId: "pol-1",
      date: "2026-01-05",
      seq: 1,
      amountCents: 73000,
      status: "succeeded",
      stripePaymentIntentId: "pi_1",
      createdAt,
      updatedAt: createdAt,
    };
    expect(paymentFromRow(row)).toStrictEqual({ id: "pay-1", date: "2026-01-05", seq: 1, amountCents: 73000, status: "succeeded" });
  });

  it.each<Allocation>([
    { paymentId: "pay-1", chargeId: "c1", amountCents: 73000, sourceEntryId: "p1" },
    { paymentId: "pay-1", chargeId: "c1", amountCents: -73000, sourceEntryId: "r1" },
    { paymentId: "pay-1", chargeId: "c2", amountCents: 100, sourceEntryId: null },
  ])("round-trips allocation %o", (allocation) => {
    const row: PaymentAllocationRow = { ...allocationToRow(allocation, ctx), id: "a1", createdAt } as PaymentAllocationRow;
    expect(row).toMatchObject(ctx);
    expect(allocationFromRow(row)).toStrictEqual(allocation);
  });
});

describe("termFromPolicy", () => {
  it("derives actual term days", () => {
    expect(termFromPolicy({ termStart: "2026-01-01", termEnd: "2027-01-01" })).toStrictEqual({
      start: "2026-01-01",
      end: "2027-01-01",
      days: 365,
    });
    expect(termFromPolicy({ termStart: "2027-06-01", termEnd: "2028-06-01" }).days).toBe(366);
  });

  it("rejects a term that is not exactly 12 months", () => {
    expect(() => termFromPolicy({ termStart: "2026-01-01", termEnd: "2026-12-31" })).toThrow();
  });
});
