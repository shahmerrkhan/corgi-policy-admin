// Database schema (step 3). Money is integer cents (bigint, read as JS number); calendar
// dates are Postgres `date` read as "YYYY-MM-DD" strings; timestamptz is audit time only.
// Append-only tables (UPDATE/DELETE/TRUNCATE blocked by triggers in drizzle/):
//   policy_events, ledger_entries, payment_allocations, payment_status_events, coverage_lines,
//   stripe_events.
// policies and payments may change only through guard triggers (see the trigger migration).

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const cents = (name: string) => bigint(name, { mode: "number" });
const isoDate = (name: string) => date(name, { mode: "string" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const fk = { onDelete: "restrict", onUpdate: "restrict" } as const;

export const policyStatus = pgEnum("policy_status", ["active", "cancelled"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed"]);
export const entryType = pgEnum("entry_type", ["CHARGE", "REVERSAL", "CREDIT", "PAYMENT", "REFUND"]);
export const eventType = pgEnum("event_type", [
  "POLICY_ISSUED",
  "COVERAGE_ADDED",
  "EFFECTIVE_DATE_CORRECTED",
  "POLICY_CANCELLED",
  "PAYMENT_RECORDED",
  "REFUND_ISSUED",
]);
export const stripeEventOutcome = pgEnum("stripe_event_outcome", ["recorded", "ignored"]);
export const actorRole = pgEnum("actor_role", ["broker", "policyholder", "stripe", "system"]);

export const policyNumberSeq = pgSequence("policy_number_seq", { startWith: 1 });

/** Issues policies. Mutable profile. */
export const brokers = pgTable("brokers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  clerkUserId: text("clerk_user_id").unique(),
  createdAt: createdAt(),
});

/** The policyholder and their policy-ready profile. Mutable profile. */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerId: uuid("broker_id")
    .notNull()
    .references(() => brokers.id, fk),
  legalName: text("legal_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("CA"),
  businessDescription: text("business_description").notNull(),
  clerkUserId: text("clerk_user_id").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One CGL term. Only active -> cancelled may change (guard trigger), traced by POLICY_CANCELLED. */
export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyNumber: text("policy_number")
      .notNull()
      .unique()
      .default(sql`('CGL-' || lpad(nextval('policy_number_seq')::text, 6, '0'))`),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, fk),
    brokerId: uuid("broker_id")
      .notNull()
      .references(() => brokers.id, fk),
    product: text("product").notNull().default("CGL"),
    termStart: isoDate("term_start").notNull(),
    termEnd: isoDate("term_end").notNull(),
    limitCents: cents("limit_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    premiumCents: cents("premium_cents").notNull(),
    status: policyStatus("status").notNull().default("active"),
    cancelDate: isoDate("cancel_date"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("policies_customer_idx").on(t.customerId),
    check("policies_product_cgl", sql`${t.product} = 'CGL'`),
    check("policies_term_12_months", sql`${t.termEnd} = (${t.termStart} + interval '12 months')::date`),
    check(
      "policies_term_start_not_feb29",
      sql`NOT (extract(month from ${t.termStart}) = 2 AND extract(day from ${t.termStart}) = 29)`,
    ),
    check("policies_limit_positive", sql`${t.limitCents} > 0`),
    check("policies_rate_positive", sql`${t.rateBps} > 0`),
    check(
      "policies_premium_round_half_up",
      sql`${t.premiumCents} = (${t.limitCents} * ${t.rateBps} + 5000) / 10000`,
    ),
    check(
      "policies_cancel_shape",
      sql`(${t.status} = 'active' AND ${t.cancelDate} IS NULL AND ${t.cancelReason} IS NULL)
        OR (${t.status} = 'cancelled' AND ${t.cancelDate} IS NOT NULL AND ${t.cancelReason} IS NOT NULL
            AND btrim(${t.cancelReason}) <> ''
            AND ${t.cancelDate} >= ${t.termStart} AND ${t.cancelDate} < ${t.termEnd})`,
    ),
  ],
);

/** Audit trail: one row per command. Append-only. */
export const policyEvents = pgTable(
  "policy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    position: bigint("position", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, fk),
    type: eventType("type").notNull(),
    transactionDate: isoDate("transaction_date").notNull(),
    actorRole: actorRole("actor_role").notNull(),
    actorUserId: text("actor_user_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique("policy_events_position_unique").on(t.position), index("policy_events_policy_idx").on(t.policyId)],
);

/** An added named coverage with its own limit and rate. Append-only. */
export const coverageLines = pgTable(
  "coverage_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, fk),
    eventId: uuid("event_id")
      .notNull()
      .references(() => policyEvents.id, fk),
    name: text("name").notNull(),
    limitCents: cents("limit_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    premiumCents: cents("premium_cents").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("coverage_lines_policy_idx").on(t.policyId),
    check("coverage_lines_name_present", sql`btrim(${t.name}) <> ''`),
    check("coverage_lines_limit_positive", sql`${t.limitCents} > 0`),
    check("coverage_lines_rate_positive", sql`${t.rateBps} > 0`),
    check(
      "coverage_lines_premium_round_half_up",
      sql`${t.premiumCents} = (${t.limitCents} * ${t.rateBps} + 5000) / 10000`,
    ),
  ],
);

/** A payment. Only pending -> succeeded|failed may change (guard trigger), traced by payment_status_events. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, fk),
    date: isoDate("date").notNull(),
    seq: integer("seq").notNull(),
    amountCents: cents("amount_cents").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
    /** The webhook event that recorded this payment. */
    stripeEventId: text("stripe_event_id").notNull().unique(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payments_policy_seq_unique").on(t.policyId, t.seq),
    check("payments_amount_positive", sql`${t.amountCents} > 0`),
    check("payments_currency_usd", sql`${t.currency} = 'usd'`),
    check("payments_seq_positive", sql`${t.seq} > 0`),
  ],
);

/** Every money movement on a policy. One row per domain LedgerEntry. Append-only. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, fk),
    eventId: uuid("event_id")
      .notNull()
      .references(() => policyEvents.id, fk),
    type: entryType("type").notNull(),
    date: isoDate("date").notNull(),
    seq: integer("seq").notNull(),
    amountCents: cents("amount_cents").notNull(),
    effectiveDate: isoDate("effective_date"),
    premiumCents: cents("premium_cents"),
    rebookOf: uuid("rebook_of").references((): AnyPgColumn => ledgerEntries.id, fk),
    coverageLineId: uuid("coverage_line_id").references(() => coverageLines.id, fk),
    reversesEntryId: uuid("reverses_entry_id")
      .unique()
      .references((): AnyPgColumn => ledgerEntries.id, fk),
    chargeId: uuid("charge_id").references((): AnyPgColumn => ledgerEntries.id, fk),
    paymentId: uuid("payment_id").references(() => payments.id, fk),
    stripeRefundId: text("stripe_refund_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ledger_entries_policy_seq_unique").on(t.policyId, t.seq),
    uniqueIndex("ledger_entries_one_payment_entry")
      .on(t.paymentId)
      .where(sql`${t.type} = 'PAYMENT'`),
    uniqueIndex("ledger_entries_stripe_refund_id_unique")
      .on(t.stripeRefundId)
      .where(sql`${t.stripeRefundId} IS NOT NULL`),
    index("ledger_entries_charge_idx").on(t.chargeId),
    check("ledger_entries_seq_positive", sql`${t.seq} > 0`),
    check(
      "ledger_entries_charge_shape",
      sql`${t.type} <> 'CHARGE' OR (${t.amountCents} >= 0 AND ${t.effectiveDate} IS NOT NULL
        AND ${t.premiumCents} IS NOT NULL AND ${t.premiumCents} > 0
        AND ${t.reversesEntryId} IS NULL AND ${t.chargeId} IS NULL
        AND ${t.paymentId} IS NULL AND ${t.stripeRefundId} IS NULL)`,
    ),
    check(
      "ledger_entries_reversal_shape",
      sql`${t.type} <> 'REVERSAL' OR (${t.amountCents} <= 0 AND ${t.reversesEntryId} IS NOT NULL
        AND ${t.effectiveDate} IS NULL AND ${t.premiumCents} IS NULL AND ${t.rebookOf} IS NULL
        AND ${t.coverageLineId} IS NULL AND ${t.chargeId} IS NULL
        AND ${t.paymentId} IS NULL AND ${t.stripeRefundId} IS NULL)`,
    ),
    check(
      "ledger_entries_credit_shape",
      sql`${t.type} <> 'CREDIT' OR (${t.amountCents} < 0 AND ${t.chargeId} IS NOT NULL
        AND ${t.effectiveDate} IS NOT NULL AND ${t.premiumCents} IS NULL AND ${t.rebookOf} IS NULL
        AND ${t.coverageLineId} IS NULL AND ${t.reversesEntryId} IS NULL
        AND ${t.paymentId} IS NULL AND ${t.stripeRefundId} IS NULL)`,
    ),
    check(
      "ledger_entries_payment_shape",
      sql`${t.type} <> 'PAYMENT' OR (${t.amountCents} < 0 AND ${t.paymentId} IS NOT NULL
        AND ${t.effectiveDate} IS NULL AND ${t.premiumCents} IS NULL AND ${t.rebookOf} IS NULL
        AND ${t.coverageLineId} IS NULL AND ${t.reversesEntryId} IS NULL
        AND ${t.chargeId} IS NULL AND ${t.stripeRefundId} IS NULL)`,
    ),
    check(
      "ledger_entries_refund_shape",
      sql`${t.type} <> 'REFUND' OR (${t.amountCents} > 0 AND ${t.paymentId} IS NOT NULL
        AND ${t.stripeRefundId} IS NOT NULL
        AND ${t.effectiveDate} IS NULL AND ${t.premiumCents} IS NULL AND ${t.rebookOf} IS NULL
        AND ${t.coverageLineId} IS NULL AND ${t.reversesEntryId} IS NULL AND ${t.chargeId} IS NULL)`,
    ),
  ],
);

/** Cash applied to (positive) or released from (negative) a charge. Append-only. */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, fk),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, fk),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => ledgerEntries.id, fk),
    amountCents: cents("amount_cents").notNull(),
    sourceEntryId: uuid("source_entry_id").references(() => ledgerEntries.id, fk),
    eventId: uuid("event_id")
      .notNull()
      .references(() => policyEvents.id, fk),
    createdAt: createdAt(),
  },
  (t) => [
    index("payment_allocations_policy_idx").on(t.policyId),
    check("payment_allocations_amount_nonzero", sql`${t.amountCents} <> 0`),
    check(
      "payment_allocations_release_has_source",
      sql`${t.amountCents} > 0 OR ${t.sourceEntryId} IS NOT NULL`,
    ),
  ],
);

/** Every payment status change (Stripe webhook or app). Append-only. */
export const paymentStatusEvents = pgTable(
  "payment_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, fk),
    fromStatus: paymentStatus("from_status"),
    toStatus: paymentStatus("to_status").notNull(),
    stripeEventId: text("stripe_event_id").unique(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("payment_status_events_payment_idx").on(t.paymentId),
    check(
      "payment_status_events_changes",
      sql`${t.fromStatus} IS NULL OR ${t.fromStatus} <> ${t.toStatus}`,
    ),
  ],
);

/**
 * Every processed Stripe webhook event (checkout.session.completed, paid), recorded or
 * ignored with a reason. Unique stripe_event_id is the idempotency gate. Append-only.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    type: text("type").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    outcome: stripeEventOutcome("outcome").notNull(),
    reason: text("reason"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "stripe_events_reason_iff_ignored",
      sql`(${t.outcome} = 'ignored' AND ${t.reason} IS NOT NULL AND btrim(${t.reason}) <> '')
        OR (${t.outcome} = 'recorded' AND ${t.reason} IS NULL)`,
    ),
  ],
);

export type BrokerRow = typeof brokers.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type PolicyRow = typeof policies.$inferSelect;
export type PolicyEventRow = typeof policyEvents.$inferSelect;
export type CoverageLineRow = typeof coverageLines.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntryRow = typeof ledgerEntries.$inferInsert;
export type PaymentAllocationRow = typeof paymentAllocations.$inferSelect;
export type NewPaymentAllocationRow = typeof paymentAllocations.$inferInsert;
export type PaymentStatusEventRow = typeof paymentStatusEvents.$inferSelect;
export type StripeEventRow = typeof stripeEvents.$inferSelect;
