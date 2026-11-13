// Pure statement and timeline view model: stored rows in, display rows out. No DB, so
// component tests build statements the same way the pages do. Money comes from the
// stored amounts and lib/domain (runningBalances, explainCharge); nothing is recomputed here.
import {
  assertTerm,
  daysBetween,
  explainCharge,
  runningBalances,
  type ChargeExplanation,
  type EntryType,
  type LedgerEntry,
  type PaymentStatus,
  type Term,
} from "@/lib/domain";
import type { PolicyListItem } from "./read-models";

export type EntryRef = { id: string; seq: number };

export type ChargeCalculation = ChargeExplanation & {
  /** "Policy" or the coverage line's name: where the limit and rate came from. */
  source: string;
};

export type StatementRow = {
  id: string;
  seq: number;
  date: string;
  type: EntryType;
  description: string;
  amountCents: number;
  /** Balance after this entry, oldest first. */
  balanceCents: number;
  reversedBy: EntryRef | null;
  reverses: EntryRef | null;
  calculation: ChargeCalculation | null;
};

export type BalanceSummary = {
  kind: "due" | "credit";
  /** Always >= 0: the amount shown next to "Balance due" or "Credit". */
  cents: number;
};

export type TimelineEvent = {
  id: string;
  type: string;
  label: string;
  transactionDate: string;
  actor: string;
  relatedEntries: EntryRef[];
  paymentStatus: PaymentStatus | null;
};

export type PolicyStatement = {
  policy: PolicyListItem;
  rows: StatementRow[];
  balance: BalanceSummary;
  /** Newest first. */
  events: TimelineEvent[];
};

export const EVENT_LABEL: Record<string, string> = {
  POLICY_ISSUED: "Policy issued",
  COVERAGE_ADDED: "Coverage added",
  EFFECTIVE_DATE_CORRECTED: "Effective date corrected",
  POLICY_CANCELLED: "Policy cancelled",
  PAYMENT_RECORDED: "Payment recorded",
  REFUND_ISSUED: "Refund issued",
};

const PAYMENT_EVENTS = new Set(["PAYMENT_RECORDED", "REFUND_ISSUED"]);

const ROLE_LABEL: Record<string, string> = { broker: "Broker", policyholder: "Policyholder" };

export function balanceSummary(balanceCents: number): BalanceSummary {
  // Zero reads "Balance due $0.00" (owner decision, step 6).
  return balanceCents < 0 ? { kind: "credit", cents: -balanceCents } : { kind: "due", cents: balanceCents };
}

export function describeEntry(
  entry: LedgerEntry,
  bySeq: (id: string) => number | undefined,
  lineName: (id: string) => string | undefined,
): string {
  switch (entry.type) {
    case "CHARGE":
      if (entry.coverageLineId) return `Premium, ${lineName(entry.coverageLineId) ?? "coverage line"}`;
      return entry.rebookOf ? "Premium, corrected effective date" : "Premium, policy issued";
    case "REVERSAL":
      return `Reversal of #${bySeq(entry.reversesEntryId) ?? "?"}`;
    case "CREDIT":
      return "Return premium, cancellation";
    case "PAYMENT":
      return "Payment";
    case "REFUND":
      return "Refund";
  }
}

export type StatementInput = {
  policy: PolicyListItem;
  /** Ledger entries with the event that wrote each one. */
  entryRows: { entry: LedgerEntry; eventId: string }[];
  /** Events, newest first. */
  eventRows: {
    id: string;
    type: string;
    transactionDate: string;
    actorRole: string;
    actorUserId: string | null;
    payload: unknown;
  }[];
  lineRows: { id: string; name: string; limitCents: number; rateBps: number }[];
  paymentRows: { id: string; status: PaymentStatus }[];
  actorNames: { role: "broker" | "policyholder"; clerkUserId: string; name: string }[];
};

function termFromPolicy(p: Pick<PolicyListItem, "termStart" | "termEnd">): Term {
  return assertTerm({ start: p.termStart, end: p.termEnd, days: daysBetween(p.termStart, p.termEnd) });
}

export function buildStatement(input: StatementInput): PolicyStatement {
  const { policy, entryRows, eventRows, lineRows, paymentRows, actorNames } = input;
  const term = termFromPolicy(policy);
  const entries = entryRows.map((r) => r.entry);
  const seqOf = new Map(entries.map((e) => [e.id, e.seq]));
  const lines = new Map(lineRows.map((l) => [l.id, l]));
  const reversedBy = new Map<string, EntryRef>();
  for (const e of entries) if (e.type === "REVERSAL") reversedBy.set(e.reversesEntryId, { id: e.id, seq: e.seq });

  const rows: StatementRow[] = runningBalances(entries).map(({ entry, balanceCents }) => {
    let calculation: ChargeCalculation | null = null;
    if (entry.type === "CHARGE") {
      const line = entry.coverageLineId ? lines.get(entry.coverageLineId) : undefined;
      const source = line ?? { name: "Policy", limitCents: policy.limitCents, rateBps: policy.rateBps };
      calculation = {
        ...explainCharge({ limitCents: source.limitCents, rateBps: source.rateBps, term, charge: entry }),
        source: source.name,
      };
    }
    const reverses =
      entry.type === "REVERSAL" ? { id: entry.reversesEntryId, seq: seqOf.get(entry.reversesEntryId) ?? 0 } : null;
    return {
      id: entry.id,
      seq: entry.seq,
      date: entry.date,
      type: entry.type,
      description: describeEntry(entry, (id) => seqOf.get(id), (id) => lines.get(id)?.name),
      amountCents: entry.amountCents,
      balanceCents,
      reversedBy: reversedBy.get(entry.id) ?? null,
      reverses,
      calculation,
    };
  });
  const finalBalance = rows.length ? rows[rows.length - 1]!.balanceCents : 0;

  const names = new Map(actorNames.map((a) => [`${a.role}:${a.clerkUserId}`, a.name]));
  const paymentStatus = new Map(paymentRows.map((p) => [p.id, p.status]));
  const entryEvent = new Map(entryRows.map((row) => [row.entry.id, row.eventId]));

  const events: TimelineEvent[] = eventRows.map((ev) => {
    const related = entries.filter((e) => entryEvent.get(e.id) === ev.id);
    let status: PaymentStatus | null = null;
    if (PAYMENT_EVENTS.has(ev.type)) {
      const fromEntry = related.find((e) => e.type === "PAYMENT" || e.type === "REFUND");
      const payload = ev.payload as { paymentId?: unknown } | null;
      const paymentId =
        fromEntry && "paymentId" in fromEntry
          ? fromEntry.paymentId
          : typeof payload?.paymentId === "string"
            ? payload.paymentId
            : null;
      status = paymentId ? (paymentStatus.get(paymentId) ?? null) : null;
    }
    return {
      id: ev.id,
      type: ev.type,
      label: EVENT_LABEL[ev.type] ?? ev.type,
      transactionDate: ev.transactionDate,
      actor: actorLabel(ev.actorRole, ev.actorUserId, names),
      relatedEntries: related.map((e) => ({ id: e.id, seq: e.seq })),
      paymentStatus: status,
    };
  });

  return { policy, rows, balance: balanceSummary(finalBalance), events };
}

function actorLabel(role: string, userId: string | null, names: Map<string, string>): string {
  const roleLabel = ROLE_LABEL[role];
  if (!roleLabel) return "System";
  const name = userId ? names.get(`${role}:${userId}`) : undefined;
  return name ? `${name} (${roleLabel})` : roleLabel;
}
