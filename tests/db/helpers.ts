// Every db test runs inside withTx and ends by throwing Rollback, so nothing is ever
// committed to the real database (append-only rows could never be removed).
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { type SQL } from "drizzle-orm";
import {
  brokers,
  coverageLines,
  customers,
  ledgerEntries,
  paymentAllocations,
  payments,
  paymentStatusEvents,
  policies,
  policyEvents,
} from "@/lib/db/schema";
import { type Tx, withTx } from "@/lib/db/with-tx";

export class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

/** Runs fn in a transaction that is always rolled back. */
export async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    withTx(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

function messages(err: unknown): string {
  const out: string[] = [];
  let e: unknown = err;
  while (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") out.push(m);
    e = (e as { cause?: unknown }).cause;
  }
  return out.join(" | ");
}

/** Runs a statement under a savepoint and expects the database to reject it. */
export async function expectRejected(tx: Tx, statement: SQL, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await tx.transaction(async (sp) => {
      await sp.execute(statement);
    });
  } catch (err) {
    error = err;
  }
  expect(error, `expected rejection matching ${pattern}`).toBeDefined();
  expect(messages(error)).toMatch(pattern);
}

/** Runs a statement under a savepoint and expects it to succeed. */
export async function expectAccepted(tx: Tx, statement: SQL): Promise<void> {
  await tx.transaction(async (sp) => {
    await sp.execute(statement);
  });
}

/** One row in every table, linked like a real policy. */
export async function insertFixture(tx: Tx) {
  const ids = {
    broker: randomUUID(),
    customer: randomUUID(),
    policy: randomUUID(),
    event: randomUUID(),
    coverageLine: randomUUID(),
    payment: randomUUID(),
    charge: randomUUID(),
    paymentEntry: randomUUID(),
    allocation: randomUUID(),
    statusEvent: randomUUID(),
  };
  const tag = ids.broker.slice(0, 8);
  await tx.insert(brokers).values({ id: ids.broker, name: "Test Broker", email: `broker-${tag}@test.invalid` });
  await tx.insert(customers).values({
    id: ids.customer,
    brokerId: ids.broker,
    legalName: "Test Co",
    contactName: "Test Contact",
    email: `customer-${tag}@test.invalid`,
    phone: "+1 000 000 0000",
    addressLine1: "1 Test St",
    city: "Toronto",
    region: "ON",
    postalCode: "M5H 1A1",
    businessDescription: "Test",
  });
  await tx.insert(policies).values({
    id: ids.policy,
    customerId: ids.customer,
    brokerId: ids.broker,
    termStart: "2026-01-01",
    termEnd: "2027-01-01",
    limitCents: 100_000_000,
    rateBps: 100,
    premiumCents: 1_000_000,
  });
  await tx.insert(policyEvents).values({
    id: ids.event,
    policyId: ids.policy,
    type: "POLICY_ISSUED",
    transactionDate: "2026-01-01",
    actorRole: "broker",
  });
  await tx.insert(coverageLines).values({
    id: ids.coverageLine,
    policyId: ids.policy,
    eventId: ids.event,
    name: "Products-completed operations",
    limitCents: 50_000_000,
    rateBps: 100,
    premiumCents: 500_000,
  });
  await tx.insert(payments).values({
    id: ids.payment,
    policyId: ids.policy,
    date: "2026-01-05",
    seq: 1,
    amountCents: 1_000_000,
    status: "pending",
    stripePaymentIntentId: `pi_test_${ids.payment}`,
  });
  await tx.insert(ledgerEntries).values([
    {
      id: ids.charge,
      policyId: ids.policy,
      eventId: ids.event,
      type: "CHARGE",
      date: "2026-01-01",
      seq: 1,
      amountCents: 1_000_000,
      effectiveDate: "2026-01-01",
      premiumCents: 1_000_000,
    },
    {
      id: ids.paymentEntry,
      policyId: ids.policy,
      eventId: ids.event,
      type: "PAYMENT",
      date: "2026-01-05",
      seq: 2,
      amountCents: -1_000_000,
      paymentId: ids.payment,
    },
  ]);
  await tx.insert(paymentAllocations).values({
    id: ids.allocation,
    policyId: ids.policy,
    paymentId: ids.payment,
    chargeId: ids.charge,
    amountCents: 1_000_000,
    sourceEntryId: ids.paymentEntry,
    eventId: ids.event,
  });
  await tx.insert(paymentStatusEvents).values({
    id: ids.statusEvent,
    paymentId: ids.payment,
    fromStatus: null,
    toStatus: "pending",
  });
  return ids;
}
