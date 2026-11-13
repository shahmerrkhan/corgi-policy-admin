// Pure statement and timeline view model: stored rows in, display rows out. No DB, so
// component tests build statements the same way the pages do. Money comes from the
// stored amounts and lib/domain (runningBalances, explainCharge); nothing is recomputed here.
import {
  assertTerm,
  daysBetween,
  explainCharge,
  isReversed,
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
  /** Extra plain-language detail (a coverage date correction's dates and reason), or null. */
  detail: string | null;
};

/** A coverage line with its current effective date: the effective date of its one live charge. */
export type CoverageLineSummary = {
  id: string;
  name: string;
  limitCents: number;
  rateBps: number;
  /** null only if the ledger does not have exactly one live charge for the line (a data problem). */
  effectiveDate: string | null;
  liveChargeId: string | null;
  liveChargeCents: number | null;
};

export type PolicyStatement = {
  policy: PolicyListItem;
  rows: StatementRow[];
  balance: BalanceSummary;
  /** Newest first. */
  events: TimelineEvent[];
  /** Oldest first (by the line's original charge). */
  coverageLines: CoverageLineSummary[];
};

export const EVENT_LABEL: Record<string, string> = {
  POLICY_ISSUED: "Policy issued",
  COVERAGE_ADDED: "Coverage added",
  COVERAGE_DATE_CORRECTED: "Coverage date corrected",
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
      if (entry.coverageLineId) {
        const name = `Premium, ${lineName(entry.coverageLineId) ?? "coverage line"}`;
        return entry.rebookOf ? `${name} (corrected)` : name;
      }
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
      detail: eventDetail(ev.type, ev.payload),
    };
  });

  return { policy, rows, balance: balanceSummary(finalBalance), events, coverageLines: summarizeLines(lineRows, entries) };
}

function summarizeLines(lineRows: StatementInput["lineRows"], entries: LedgerEntry[]): CoverageLineSummary[] {
  const lineCharges = entries.filter((e) => e.type === "CHARGE" && e.coverageLineId !== null);
  const firstSeq = (id: string) =>
    lineCharges.filter((c) => c.type === "CHARGE" && c.coverageLineId === id).reduce((min, c) => Math.min(min, c.seq), Infinity);
  return [...lineRows]
    .sort((a, b) => firstSeq(a.id) - firstSeq(b.id))
    .map((line) => {
      // Read screens report data problems instead of throwing (step 6 rule), so no liveChargeForLine here.
      const live = lineCharges.filter(
        (c) => c.type === "CHARGE" && c.coverageLineId === line.id && !isReversed(entries, c.id),
      );
      const only = live.length === 1 && live[0]!.type === "CHARGE" ? live[0]! : null;
      return {
        id: line.id,
        name: line.name,
        limitCents: line.limitCents,
        rateBps: line.rateBps,
        effectiveDate: only && only.type === "CHARGE" ? only.effectiveDate : null,
        liveChargeId: only?.id ?? null,
        liveChargeCents: only?.amountCents ?? null,
      };
    });
}

function eventDetail(type: string, payload: unknown): string | null {
  if (type !== "COVERAGE_DATE_CORRECTED" || !payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const text = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "?");
  return `${text("coverageName")}: ${text("oldEffectiveDate")} to ${text("newEffectiveDate")}. Reason: ${text("reason")}`;
}

function actorLabel(role: string, userId: string | null, names: Map<string, string>): string {
  const roleLabel = ROLE_LABEL[role];
  if (!roleLabel) return "System";
  const name = userId ? names.get(`${role}:${userId}`) : undefined;
  return name ? `${name} (${roleLabel})` : roleLabel;
}
