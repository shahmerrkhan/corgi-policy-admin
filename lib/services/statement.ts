// Statement and timeline read model for one policy. Read only. Scoped in SQL by the
// session's broker id or customer id; a policy outside that scope returns null.
// buildStatement (statement-view.ts) turns the stored rows into display rows.
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { entryFromRow } from "@/lib/db/mappers";
import { getDb } from "@/lib/db/read";
import { brokers, coverageLines, customers, ledgerEntries, payments, policies, policyEvents } from "@/lib/db/schema";
import { policyListColumns, type Reader } from "./read-models";
import { buildStatement, type PolicyStatement, type StatementInput } from "./statement-view";

export * from "./statement-view";

function reader(r?: Reader): Reader {
  return r ?? (getDb() as unknown as Reader);
}

async function loadStatement(scope: SQL, policyId: string, r?: Reader): Promise<PolicyStatement | null> {
  const db = reader(r);
  const policyRows = await db
    .select(policyListColumns)
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .where(and(eq(policies.id, policyId), scope));
  const policy = policyRows[0];
  if (!policy) return null;

  const [entryRows, eventRows, lineRows, paymentRows] = await Promise.all([
    db.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId)).orderBy(asc(ledgerEntries.seq)),
    db.select().from(policyEvents).where(eq(policyEvents.policyId, policyId)).orderBy(desc(policyEvents.position)),
    db
      .select({ id: coverageLines.id, name: coverageLines.name, limitCents: coverageLines.limitCents, rateBps: coverageLines.rateBps })
      .from(coverageLines)
      .where(eq(coverageLines.policyId, policyId)),
    db.select({ id: payments.id, status: payments.status }).from(payments).where(eq(payments.policyId, policyId)),
  ]);

  const actorIds = [...new Set(eventRows.map((e) => e.actorUserId).filter((id): id is string => Boolean(id)))];
  const [brokerNames, customerNames] = actorIds.length
    ? await Promise.all([
        db.select({ id: brokers.clerkUserId, name: brokers.name }).from(brokers).where(inArray(brokers.clerkUserId, actorIds)),
        db
          .select({ id: customers.clerkUserId, name: customers.legalName })
          .from(customers)
          .where(inArray(customers.clerkUserId, actorIds)),
      ])
    : [[], []];

  const actorNames: StatementInput["actorNames"] = [];
  for (const b of brokerNames) if (b.id) actorNames.push({ role: "broker", clerkUserId: b.id, name: b.name });
  for (const c of customerNames) if (c.id) actorNames.push({ role: "policyholder", clerkUserId: c.id, name: c.name });
  return buildStatement({
    policy,
    entryRows: entryRows.map((row) => ({ entry: entryFromRow(row), eventId: row.eventId })),
    eventRows,
    lineRows,
    paymentRows,
    actorNames,
  });
}

/** A broker's own policy statement, or null if the policy is not theirs. */
export function getStatementForBroker(brokerId: string, policyId: string, r?: Reader) {
  return loadStatement(eq(policies.brokerId, brokerId), policyId, r);
}

/** A policyholder's own policy statement, or null if the policy belongs to another customer. */
export function getStatementForCustomer(customerId: string, policyId: string, r?: Reader) {
  return loadStatement(eq(policies.customerId, customerId), policyId, r);
}
