// Record a paid Stripe Checkout session (step 7). The webhook is the only caller and the
// only thing that writes a payment. One withTx, in this order:
//   1. pure checks on the event (policy id, livemode, currency, amount, payment intent)
//   2. lock the policy FOR UPDATE (unknown policy -> ignored)
//   3. under that lock, refuse a payment intent or session that is already recorded
//   4. insert the stripe_events gate row with its final outcome; ON CONFLICT on the event
//      id means a duplicate delivery: write nothing
//   5. payment (succeeded), status event, PAYMENT_RECORDED event, PAYMENT ledger entry,
//      FIFO allocations (lib/domain planPaymentApplication), then assertInvariants.
// The payment email is sent by the webhook route after this commits, never in here.
// 23505 is never caught here: Postgres aborts the transaction, the webhook returns 500 and
// Stripe's retry sees the committed row and becomes a no-op.
import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { assertInvariants, planPaymentApplication, type Payment } from "@/lib/domain";
import { allocationFromRow, allocationToRow, entryFromRow, entryToRow, paymentFromRow } from "@/lib/db/mappers";
import {
  ledgerEntries,
  paymentAllocations,
  payments,
  paymentStatusEvents,
  policies,
  policyEvents,
  stripeEvents,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { PAYMENT_CURRENCY } from "@/lib/stripe/currency";
import { isUuid } from "./inputs";
import type { CheckoutCompleted, RecordOutcome } from "./stripe-webhook";
import { todayIso } from "./today";

export type IgnoreReason =
  | "UNKNOWN_POLICY"
  | "LIVE_MODE"
  | "CURRENCY_MISMATCH"
  | "INVALID_AMOUNT"
  | "INVALID_PAYMENT_INTENT"
  | "DUPLICATE_PAYMENT_INTENT"
  | "DUPLICATE_CHECKOUT_SESSION";

/** Checks that need no database. The first failing one wins. */
export function precheck(input: CheckoutCompleted): IgnoreReason | null {
  if (!input.policyId || !isUuid(input.policyId)) return "UNKNOWN_POLICY";
  if (input.livemode) return "LIVE_MODE";
  if (input.currency !== PAYMENT_CURRENCY) return "CURRENCY_MISMATCH";
  if (input.amountTotal === null || !Number.isSafeInteger(input.amountTotal) || input.amountTotal <= 0) {
    return "INVALID_AMOUNT";
  }
  if (!input.paymentIntentId) return "INVALID_PAYMENT_INTENT";
  return null;
}

async function gate(tx: Tx, input: CheckoutCompleted, reason: IgnoreReason | null): Promise<boolean> {
  const inserted = await tx
    .insert(stripeEvents)
    .values({
      stripeEventId: input.eventId,
      type: input.eventType,
      stripeCheckoutSessionId: input.sessionId,
      outcome: reason ? "ignored" : "recorded",
      reason,
    })
    .onConflictDoNothing({ target: stripeEvents.stripeEventId })
    .returning({ id: stripeEvents.id });
  return inserted.length > 0;
}

async function ignore(tx: Tx, input: CheckoutCompleted, reason: IgnoreReason): Promise<RecordOutcome> {
  return (await gate(tx, input, reason)) ? { outcome: "ignored", reason } : { outcome: "duplicate" };
}

export async function recordStripePaymentCommand(tx: Tx, input: CheckoutCompleted): Promise<RecordOutcome> {
  const early = precheck(input);
  if (early === "UNKNOWN_POLICY") return ignore(tx, input, early);

  // 2. Lock the policy (policyId is a uuid here). Serialises every write on this policy.
  const policyId = input.policyId!;
  const [policy] = await tx.select({ id: policies.id }).from(policies).where(eq(policies.id, policyId)).for("update");
  if (!policy) return ignore(tx, input, "UNKNOWN_POLICY");
  if (early) return ignore(tx, input, early);
  const paymentIntentId = input.paymentIntentId!;
  const amountCents = input.amountTotal!;

  // 3. Already recorded under another event id? Checked under the lock, so a concurrent
  //    delivery for the same policy waits here and then sees the committed payment.
  const existing = await tx
    .select({ pi: payments.stripePaymentIntentId, session: payments.stripeCheckoutSessionId })
    .from(payments)
    .where(or(eq(payments.stripePaymentIntentId, paymentIntentId), eq(payments.stripeCheckoutSessionId, input.sessionId)));
  if (existing.some((p) => p.pi === paymentIntentId)) return ignore(tx, input, "DUPLICATE_PAYMENT_INTENT");
  if (existing.length > 0) return ignore(tx, input, "DUPLICATE_CHECKOUT_SESSION");

  // 4. Idempotency gate with the final outcome.
  if (!(await gate(tx, input, null))) return { outcome: "duplicate" };

  // 5. Ledger state, then the writes.
  const entries = (await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId))).map(entryFromRow);
  const allocations = (
    await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId))
  ).map(allocationFromRow);
  const paymentList = (await tx.select().from(payments).where(eq(payments.policyId, policyId))).map(paymentFromRow);

  // Live payments are dated real today: the Toronto date of the Stripe event.
  const date = todayIso(new Date(input.created * 1000));
  const payment: Payment = {
    id: randomUUID(),
    date,
    seq: paymentList.reduce((max, p) => Math.max(max, p.seq), 0) + 1,
    amountCents,
    status: "succeeded",
  };

  const plan = planPaymentApplication({ payment, date, newId: randomUUID, entries, allocations, payments: paymentList });
  if (!plan.ok) throw new Error(`payment plan rejected: ${plan.code}`);
  const [entry] = plan.value.entries;

  await tx.insert(payments).values({
    id: payment.id,
    policyId,
    date,
    seq: payment.seq,
    amountCents,
    status: "succeeded",
    stripePaymentIntentId: paymentIntentId,
    stripeCheckoutSessionId: input.sessionId,
    stripeEventId: input.eventId,
    currency: PAYMENT_CURRENCY,
  });
  await tx.insert(paymentStatusEvents).values({
    paymentId: payment.id,
    fromStatus: null,
    toStatus: "succeeded",
    stripeEventId: input.eventId,
    occurredAt: new Date(input.created * 1000),
  });

  const eventId = randomUUID();
  await tx.insert(policyEvents).values({
    id: eventId,
    policyId,
    type: "PAYMENT_RECORDED",
    transactionDate: date,
    actorRole: "stripe",
    actorUserId: null,
    payload: {
      paymentId: payment.id,
      amountCents,
      currency: PAYMENT_CURRENCY,
      stripeCheckoutSessionId: input.sessionId,
      stripePaymentIntentId: paymentIntentId,
      stripeEventId: input.eventId,
    },
  });
  await tx.insert(ledgerEntries).values(entryToRow(entry, { policyId, eventId }));
  if (plan.value.allocations.length > 0) {
    await tx.insert(paymentAllocations).values(plan.value.allocations.map((a) => allocationToRow(a, { policyId, eventId })));
  }

  assertInvariants({
    entries: [...entries, entry],
    allocations: [...allocations, ...plan.value.allocations],
    payments: [...paymentList, payment],
  });

  return { outcome: "recorded", paymentId: payment.id, eventId };
}
