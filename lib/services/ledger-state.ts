// Loads one policy's coverage lines and ledger state (entries, allocations, payments) as
// lib/domain types. Commands pass their Tx (after locking the policy); previews pass neon-http.
import { eq } from "drizzle-orm";
import { allocationFromRow, entryFromRow, paymentFromRow } from "@/lib/db/mappers";
import { coverageLines, ledgerEntries, paymentAllocations, payments } from "@/lib/db/schema";
import type { Reader } from "./read-models";

export async function loadPolicyLedger(db: Reader, policyId: string) {
  const [lineRows, entryRows, allocationRows, paymentRows] = await Promise.all([
    db
      .select({ id: coverageLines.id, name: coverageLines.name, limitCents: coverageLines.limitCents, rateBps: coverageLines.rateBps })
      .from(coverageLines)
      .where(eq(coverageLines.policyId, policyId)),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId)),
    db.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId)),
    db.select().from(payments).where(eq(payments.policyId, policyId)),
  ]);
  return {
    lines: lineRows,
    existingNames: lineRows.map((l) => l.name),
    entries: entryRows.map(entryFromRow),
    allocations: allocationRows.map(allocationFromRow),
    payments: paymentRows.map(paymentFromRow),
  };
}

export type PolicyLedger = Awaited<ReturnType<typeof loadPolicyLedger>>;
