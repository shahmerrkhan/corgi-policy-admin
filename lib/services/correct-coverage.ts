// Correct a coverage line's effective date (step 9), reverse-and-rebook. One withTx:
//   1. lock the broker's policy FOR UPDATE (another broker's policy is not found)
//   2. requestId is the new event's id: an event with that id on this policy means a
//      double submit, so write nothing and return alreadyCorrected; on another policy, reject
//   3. the line must belong to the policy; load the ledger; plan with lib/domain
//      planCoverageCorrection (expected live charge, reason, transaction-date floor)
//   4. COVERAGE_DATE_CORRECTED event, REVERSAL, rebook CHARGE, release rows, FIFO rows
//   5. assertInvariants
// The line's current effective date is never stored on coverage_lines: it is the effective
// date of the line's one live charge. Unique indexes on reverses_entry_id, rebook_of and the
// line's original charge keep that chain linear in the database.
// Link rules (same policy, reversal = -original, rebook keeps premium and line, day counts
// vs dates) are enforced here and in lib/domain, not by a DB trigger (owner decision, step 9).
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  assertInvariants,
  explainCharge,
  planCoverageCorrection,
  type ChargeExplanation,
  type PlanCoverageCorrectionValue,
  type Term,
} from "@/lib/domain";
import { allocationToRow, entryToRow, termFromPolicy } from "@/lib/db/mappers";
import { getDb } from "@/lib/db/read";
import { ledgerEntries, paymentAllocations, policies, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import type { CorrectCoverageField, CorrectCoverageInput } from "./inputs";
import { loadPolicyLedger, type PolicyLedger } from "./ledger-state";
import type { Reader } from "./read-models";
import type { ServiceFailure } from "./result";

export type CorrectCoverageFailure = ServiceFailure & {
  field?: CorrectCoverageField;
  /** Set on CHARGE_ALREADY_REVERSED: the line's current live charge. */
  latestChargeId?: string;
};
export type CorrectCoverageResult<T> = { ok: true; value: T } | CorrectCoverageFailure;

const FIELD_FOR_CODE: Record<string, CorrectCoverageField> = {
  EFFECTIVE_DATE_OUTSIDE_TERM: "newEffectiveDate",
  SAME_EFFECTIVE_DATE: "newEffectiveDate",
  REASON_REQUIRED: "reason",
  REASON_TOO_LONG: "reason",
  TRANSACTION_DATE_TOO_EARLY: "transactionDate",
};

function rejection(code: string, message: string, extra: Partial<CorrectCoverageFailure> = {}): CorrectCoverageFailure {
  const field = FIELD_FOR_CODE[code];
  return { ok: false, code, message, ...(field ? { field } : {}), ...extra };
}

export type CorrectionTarget = {
  coverageLineId: string;
  /** The live charge the review page showed. */
  expectedChargeId: string;
};

type Line = PolicyLedger["lines"][number];

function plan(
  policy: { termStart: string; termEnd: string; status: "active" | "cancelled" },
  state: PolicyLedger,
  target: CorrectionTarget,
  input: CorrectCoverageInput,
): CorrectCoverageResult<PlanCoverageCorrectionValue> {
  const term = termFromPolicy(policy);
  if (!state.entries.some((e) => e.id === target.expectedChargeId && e.type === "CHARGE")) {
    return rejection("CHARGE_NOT_FOUND", "That charge is not on this policy. Start again.");
  }
  const r = planCoverageCorrection({
    entries: state.entries,
    allocations: state.allocations,
    payments: state.payments,
    term,
    coverageLineId: target.coverageLineId,
    expectedChargeId: target.expectedChargeId,
    newEffectiveDate: input.newEffectiveDate,
    date: input.transactionDate,
    reason: input.reason,
    policyCancelled: policy.status === "cancelled",
    newId: randomUUID,
  });
  if (r.ok) return r;
  if (r.code === "EFFECTIVE_DATE_OUTSIDE_TERM") {
    return rejection(r.code, `New effective date must be on or after ${term.start} and before ${term.end} (the term end is excluded).`);
  }
  if (r.code === "CHARGE_ALREADY_REVERSED") {
    const latest = r.details?.latestChargeId;
    return rejection(r.code, "This coverage was corrected after you opened the review. Start again from its current date.", {
      ...(typeof latest === "string" ? { latestChargeId: latest } : {}),
    });
  }
  return rejection(r.code, r.message);
}

export type CorrectionPreview = {
  term: Term;
  line: Line;
  plan: PlanCoverageCorrectionValue;
  oldExplanation: ChargeExplanation;
  newExplanation: ChargeExplanation;
};

/** The line and its live charge for the correction form, or null when not the broker's. */
export async function loadLineForCorrection(brokerId: string, policyId: string, lineId: string, r?: Reader) {
  const db = r ?? (getDb() as unknown as Reader);
  const [policy] = await db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, brokerId)));
  if (!policy) return null;
  const state = await loadPolicyLedger(db, policyId);
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const live = state.entries.filter(
    (e) => e.type === "CHARGE" && e.coverageLineId === lineId && !state.entries.some((x) => x.type === "REVERSAL" && x.reversesEntryId === e.id),
  );
  const charge = live.length === 1 && live[0]!.type === "CHARGE" ? live[0]! : null;
  return { line, charge };
}

/** What the review page shows. Read only; the command recomputes and never trusts this. */
export async function previewCoverageCorrection(
  brokerId: string,
  policyId: string,
  target: CorrectionTarget,
  input: CorrectCoverageInput,
  r?: Reader,
): Promise<CorrectCoverageResult<CorrectionPreview>> {
  const db = r ?? (getDb() as unknown as Reader);
  const [policy] = await db
    .select({ termStart: policies.termStart, termEnd: policies.termEnd, status: policies.status })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, brokerId)));
  if (!policy) return rejection("POLICY_NOT_FOUND", "Policy not found.");
  const state = await loadPolicyLedger(db, policyId);
  const line = state.lines.find((l) => l.id === target.coverageLineId);
  if (!line) return rejection("LINE_NOT_FOUND", "Coverage line not found.");
  const result = plan(policy, state, target, input);
  if (!result.ok) return result;
  const term = termFromPolicy(policy);
  const source = { limitCents: line.limitCents, rateBps: line.rateBps, term };
  return {
    ok: true,
    value: {
      term,
      line,
      plan: result.value,
      oldExplanation: explainCharge({ ...source, charge: result.value.original }),
      newExplanation: explainCharge({ ...source, charge: result.value.rebook }),
    },
  };
}

export type CorrectedCoverage = {
  policyId: string;
  eventId: string;
  newChargeId: string;
  /** True when this request id was already recorded on this policy (double submit). */
  alreadyCorrected: boolean;
};

export async function correctCoverageCommand(
  tx: Tx,
  broker: { brokerId: string; clerkUserId: string },
  policyId: string,
  requestId: string,
  target: CorrectionTarget,
  input: CorrectCoverageInput,
): Promise<CorrectCoverageResult<CorrectedCoverage>> {
  // 1. Lock the policy; it must belong to this broker. Serialises every write on it.
  const [policy] = await tx
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, broker.brokerId)))
    .for("update");
  if (!policy) return rejection("POLICY_NOT_FOUND", "Policy not found.");

  // 2. Double submit: the request id is the event id.
  const [prior] = await tx
    .select({ policyId: policyEvents.policyId, type: policyEvents.type, payload: policyEvents.payload })
    .from(policyEvents)
    .where(eq(policyEvents.id, requestId));
  if (prior) {
    const newChargeId = (prior.payload as { newChargeId?: unknown } | null)?.newChargeId;
    if (prior.policyId !== policyId || prior.type !== "COVERAGE_DATE_CORRECTED" || typeof newChargeId !== "string") {
      return rejection("REQUEST_ID_CONFLICT", "This request was already used for something else. Start again.");
    }
    return { ok: true, value: { policyId, eventId: requestId, newChargeId, alreadyCorrected: true } };
  }

  // 3. Plan from the locked state.
  const state = await loadPolicyLedger(tx as unknown as Reader, policyId);
  const line = state.lines.find((l) => l.id === target.coverageLineId);
  if (!line) return rejection("LINE_NOT_FOUND", "Coverage line not found.");
  const result = plan(policy, state, target, input);
  if (!result.ok) return result;
  const p = result.value;

  // 4. Event, then entries, then allocation rows; every row carries the event id.
  const eventId = requestId;
  await tx.insert(policyEvents).values({
    id: eventId,
    policyId,
    type: "COVERAGE_DATE_CORRECTED",
    transactionDate: input.transactionDate,
    actorRole: "broker",
    actorUserId: broker.clerkUserId,
    payload: {
      coverageLineId: line.id,
      coverageName: line.name,
      oldEffectiveDate: p.original.effectiveDate,
      newEffectiveDate: p.rebook.effectiveDate,
      reason: p.reason,
      premiumCents: p.original.premiumCents,
      daysInTerm: p.daysInTerm,
      oldDaysInEffect: p.oldDaysInEffect,
      newDaysInEffect: p.newDaysInEffect,
      oldChargeId: p.original.id,
      oldAmountCents: p.original.amountCents,
      reversalId: p.reversal.id,
      newChargeId: p.rebook.id,
      newAmountCents: p.rebook.amountCents,
      netChangeCents: p.netChangeCents,
    },
  });
  // Reversal before rebook, as two inserts: the rebook re-books a reversed charge.
  await tx.insert(ledgerEntries).values(entryToRow(p.reversal, { policyId, eventId }));
  await tx.insert(ledgerEntries).values(entryToRow(p.rebook, { policyId, eventId }));
  const allocationRows = [...p.releases, ...p.allocations];
  if (allocationRows.length > 0) {
    await tx.insert(paymentAllocations).values(allocationRows.map((a) => allocationToRow(a, { policyId, eventId })));
  }

  // 5. Defence in depth.
  assertInvariants({
    entries: [...state.entries, p.reversal, p.rebook],
    allocations: [...state.allocations, ...allocationRows],
    payments: state.payments,
  });

  return { ok: true, value: { policyId, eventId, newChargeId: p.rebook.id, alreadyCorrected: false } };
}
