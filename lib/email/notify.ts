// Customer emails (step 11). Called only AFTER the business transaction has committed, never
// inside withTx. Nothing here throws: a missing key, a disallowed recipient, a Resend error or
// a database error is logged (email_log and/or console) and the payment or correction stands.
//
// Once per (kind, event_id): an existing email_log row means "already handled", so no send.
// The Idempotency-Key header covers the small window between the send and the log insert.
// Console lines carry the kind, event id and outcome only: never the key, body or recipient.
import { and, eq } from "drizzle-orm";
import { balanceCents } from "@/lib/domain";
import { getDb } from "@/lib/db/read";
import { customers, emailLog, policies, policyEvents, type PolicyEventRow } from "@/lib/db/schema";
import { withTx } from "@/lib/db/with-tx";
import { loadPolicyLedger } from "@/lib/services/ledger-state";
import type { Reader } from "@/lib/services/read-models";
import { coverageCorrectedMessage, paymentReceivedMessage, type Message } from "./messages";
import { sendViaResend, type FetchLike } from "./resend";

export type EmailKind = "PAYMENT_RECEIVED" | "COVERAGE_DATE_CORRECTED";
export type EmailStatus = "sent" | "skipped" | "failed";

export const DEFAULT_ALLOWED_TO = "delivered@resend.dev";

export type EmailLogInsert = {
  kind: EmailKind;
  eventId: string;
  policyId: string;
  recipient: string;
  status: EmailStatus;
  providerId: string | null;
  error: string | null;
};

export type EmailStore = {
  alreadyLogged: (kind: EmailKind, eventId: string) => Promise<boolean>;
  insert: (row: EmailLogInsert) => Promise<void>;
};

export type EmailEnv = { RESEND_API_KEY?: string; RESEND_ALLOWED_TO?: string };

export type DeliverDeps = {
  env: EmailEnv;
  fetch: FetchLike;
  store: EmailStore;
  log: (line: string) => void;
};

export type Delivery = { kind: EmailKind; eventId: string; policyId: string; recipient: string; message: Message };

export type DeliverOutcome = EmailStatus | "duplicate" | "error";

/** Comma-separated, case-insensitive. Unset or blank means the default sandbox address. */
export function allowedRecipients(raw: string | undefined): Set<string> {
  const list = (raw?.trim() ? raw : DEFAULT_ALLOWED_TO)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export async function deliverOnce(d: Delivery, deps: DeliverDeps): Promise<DeliverOutcome> {
  const tag = `email ${d.kind} ${d.eventId}`;
  try {
    if (await deps.store.alreadyLogged(d.kind, d.eventId)) {
      deps.log(`${tag}: already handled, not sent again`);
      return "duplicate";
    }

    const base = { kind: d.kind, eventId: d.eventId, policyId: d.policyId, recipient: d.recipient };
    let row: EmailLogInsert;
    const apiKey = deps.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      row = { ...base, status: "skipped", providerId: null, error: "RESEND_API_KEY not set" };
    } else if (!allowedRecipients(deps.env.RESEND_ALLOWED_TO).has(d.recipient.trim().toLowerCase())) {
      row = { ...base, status: "skipped", providerId: null, error: "recipient not in RESEND_ALLOWED_TO" };
    } else {
      const sent = await sendViaResend(
        apiKey,
        { to: d.recipient, ...d.message, idempotencyKey: `${d.kind}/${d.eventId}` },
        deps.fetch,
      );
      row = sent.ok
        ? { ...base, status: "sent", providerId: sent.id, error: null }
        : { ...base, status: "failed", providerId: null, error: sent.error.slice(0, 300) };
    }

    await deps.store.insert(row);
    deps.log(`${tag}: ${row.status}${row.error ? ` (${row.error})` : ""}`);
    return row.status;
  } catch (err) {
    deps.log(`${tag}: error (${errorName(err)}), payment or correction unaffected`);
    return "error";
  }
}

// ---- Real dependencies -------------------------------------------------------------

const reader = () => getDb() as unknown as Reader;

export const dbEmailStore: EmailStore = {
  async alreadyLogged(kind, eventId) {
    const rows = await getDb()
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(and(eq(emailLog.kind, kind), eq(emailLog.eventId, eventId)))
      .limit(1);
    return rows.length > 0;
  },
  async insert(row) {
    // Its own small transaction, after the business one committed. A concurrent duplicate
    // loses on the unique (kind, event_id) and writes nothing.
    await withTx((tx) => tx.insert(emailLog).values(row).onConflictDoNothing().then(() => undefined));
  },
};

function realDeps(): DeliverDeps {
  return {
    env: { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_ALLOWED_TO: process.env.RESEND_ALLOWED_TO },
    fetch: (url, init) => fetch(url, init),
    store: dbEmailStore,
    log: (line) => console.info(line),
  };
}

type EventContext = {
  policyId: string;
  policyNumber: string;
  recipient: string;
  transactionDate: string;
  payload: Record<string, unknown>;
  balanceCents: number;
};

/** The event, its policy, the customer's contact email and the committed ledger balance. */
async function loadEventContext(eventId: string, type: PolicyEventRow["type"]): Promise<EventContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      policyId: policyEvents.policyId,
      transactionDate: policyEvents.transactionDate,
      payload: policyEvents.payload,
      policyNumber: policies.policyNumber,
      recipient: customers.email,
    })
    .from(policyEvents)
    .innerJoin(policies, eq(policies.id, policyEvents.policyId))
    .innerJoin(customers, eq(customers.id, policies.customerId))
    .where(and(eq(policyEvents.id, eventId), eq(policyEvents.type, type)));
  if (!row) return null;
  const ledger = await loadPolicyLedger(reader(), row.policyId);
  return {
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    recipient: row.recipient,
    transactionDate: row.transactionDate,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    balanceCents: balanceCents(ledger.entries),
  };
}

const num = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new TypeError("event payload amount is not integer cents");
  return v;
};
const str = (v: unknown): string => {
  if (typeof v !== "string") throw new TypeError("event payload field is not a string");
  return v;
};

async function notify(
  kind: EmailKind,
  eventType: PolicyEventRow["type"],
  eventId: string,
  build: (ctx: EventContext) => Message,
  deps: DeliverDeps,
): Promise<DeliverOutcome> {
  try {
    const ctx = await loadEventContext(eventId, eventType);
    if (!ctx) {
      deps.log(`email ${kind} ${eventId}: event not found, nothing sent`);
      return "error";
    }
    return await deliverOnce(
      { kind, eventId, policyId: ctx.policyId, recipient: ctx.recipient, message: build(ctx) },
      deps,
    );
  } catch (err) {
    deps.log(`email ${kind} ${eventId}: error (${errorName(err)}), payment or correction unaffected`);
    return "error";
  }
}

/** After the webhook committed a PAYMENT_RECORDED event. Never throws. */
export function notifyPaymentReceived(eventId: string, deps: DeliverDeps = realDeps()): Promise<DeliverOutcome> {
  return notify("PAYMENT_RECEIVED", "PAYMENT_RECORDED", eventId, (ctx) =>
    paymentReceivedMessage({
      policyNumber: ctx.policyNumber,
      amountCents: num(ctx.payload.amountCents),
      paymentDate: ctx.transactionDate,
      balanceCents: ctx.balanceCents,
    }),
  deps);
}

/** After a COVERAGE_DATE_CORRECTED event committed. Never throws. */
export function notifyCoverageCorrected(eventId: string, deps: DeliverDeps = realDeps()): Promise<DeliverOutcome> {
  return notify("COVERAGE_DATE_CORRECTED", "COVERAGE_DATE_CORRECTED", eventId, (ctx) =>
    coverageCorrectedMessage({
      policyNumber: ctx.policyNumber,
      coverageName: str(ctx.payload.coverageName),
      oldEffectiveDate: str(ctx.payload.oldEffectiveDate),
      newEffectiveDate: str(ctx.payload.newEffectiveDate),
      oldAmountCents: num(ctx.payload.oldAmountCents),
      newAmountCents: num(ctx.payload.newAmountCents),
      netChangeCents: num(ctx.payload.netChangeCents),
      balanceCents: ctx.balanceCents,
    }),
  deps);
}
