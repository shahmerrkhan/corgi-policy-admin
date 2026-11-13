// Read models. Default reader is Drizzle over neon-http (getDb()); db tests pass a Tx so
// they can read their own rolled-back rows. Every query is scoped by the actor's id,
// which always comes from the session, never from the client.
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { LedgerEntry } from "@/lib/domain";
import { entryFromRow } from "@/lib/db/mappers";
import { getDb } from "@/lib/db/read";
import * as schema from "@/lib/db/schema";
import { brokers, customers, ledgerEntries, policies, policyEvents } from "@/lib/db/schema";

/** neon-http database or a transaction: anything that can run a select. */
export type Reader = PgDatabase<PgQueryResultHKT, typeof schema>;

function reader(r?: Reader): Reader {
  return r ?? (getDb() as unknown as Reader);
}

export async function findBrokerByClerkId(clerkUserId: string, r?: Reader) {
  const rows = await reader(r)
    .select({ id: brokers.id, name: brokers.name })
    .from(brokers)
    .where(eq(brokers.clerkUserId, clerkUserId));
  return rows[0] ?? null;
}

export async function findCustomerByClerkId(clerkUserId: string, r?: Reader) {
  const rows = await reader(r)
    .select({ id: customers.id, legalName: customers.legalName })
    .from(customers)
    .where(eq(customers.clerkUserId, clerkUserId));
  return rows[0] ?? null;
}

export type CustomerListItem = {
  id: string;
  legalName: string;
  contactName: string;
  email: string;
  city: string;
  region: string;
};

export async function listCustomersForBroker(brokerId: string, r?: Reader): Promise<CustomerListItem[]> {
  return reader(r)
    .select({
      id: customers.id,
      legalName: customers.legalName,
      contactName: customers.contactName,
      email: customers.email,
      city: customers.city,
      region: customers.region,
    })
    .from(customers)
    .where(eq(customers.brokerId, brokerId))
    .orderBy(asc(customers.legalName));
}

export async function getCustomerForBroker(brokerId: string, customerId: string, r?: Reader) {
  const rows = await reader(r)
    .select({ id: customers.id, legalName: customers.legalName })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.brokerId, brokerId)));
  return rows[0] ?? null;
}

export type PolicyListItem = {
  id: string;
  policyNumber: string;
  customerId: string;
  customerName: string;
  termStart: string;
  termEnd: string;
  limitCents: number;
  rateBps: number;
  premiumCents: number;
  status: "active" | "cancelled";
};

const policyListColumns = {
  id: policies.id,
  policyNumber: policies.policyNumber,
  customerId: policies.customerId,
  customerName: customers.legalName,
  termStart: policies.termStart,
  termEnd: policies.termEnd,
  limitCents: policies.limitCents,
  rateBps: policies.rateBps,
  premiumCents: policies.premiumCents,
  status: policies.status,
};

export async function listPoliciesForBroker(brokerId: string, r?: Reader): Promise<PolicyListItem[]> {
  return reader(r)
    .select(policyListColumns)
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .where(eq(policies.brokerId, brokerId))
    .orderBy(desc(policies.policyNumber));
}

export async function listPoliciesForCustomer(customerId: string, r?: Reader): Promise<PolicyListItem[]> {
  return reader(r)
    .select(policyListColumns)
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .where(eq(policies.customerId, customerId))
    .orderBy(desc(policies.policyNumber));
}

export type PolicyEventItem = {
  id: string;
  type: string;
  transactionDate: string;
  actorRole: string;
};

export type PolicyDetail = {
  policy: PolicyListItem;
  events: PolicyEventItem[];
  entries: LedgerEntry[];
};

/** A broker's own policy with its events (by position) and ledger entries (by seq), or null. */
export async function getPolicyForBroker(brokerId: string, policyId: string, r?: Reader): Promise<PolicyDetail | null> {
  const db = reader(r);
  const rows = await db
    .select(policyListColumns)
    .from(policies)
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, brokerId)));
  const policy = rows[0];
  if (!policy) return null;
  const events = await db
    .select({
      id: policyEvents.id,
      type: policyEvents.type,
      transactionDate: policyEvents.transactionDate,
      actorRole: policyEvents.actorRole,
    })
    .from(policyEvents)
    .where(eq(policyEvents.policyId, policyId))
    .orderBy(asc(policyEvents.position));
  const entryRows = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.policyId, policyId))
    .orderBy(asc(ledgerEntries.seq));
  return { policy, events, entries: entryRows.map(entryFromRow) };
}
