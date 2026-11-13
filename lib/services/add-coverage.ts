// Add coverage to an active policy (step 8). The review page previews with the same domain
// planner the command uses; the command recomputes everything inside one withTx:
//   1. lock the broker's policy FOR UPDATE (another broker's policy is not found)
//   2. requestId check under the lock: a coverage line with that id on this policy means a
//      double submit, so write nothing and return alreadyAdded; on another policy, reject
//   3. load lines and ledger state, plan with lib/domain planAddCoverage
//   4. COVERAGE_ADDED event, coverage line, CHARGE (with its day counts), FIFO allocations
//   5. assertInvariants
// The unique index on (policy_id, lower(btrim(name))) backs the domain's name check.
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  assertInvariants,
  explainCharge,
  planAddCoverage,
  type ChargeExplanation,
  type PlanAddCoverageValue,
  type Term,
} from "@/lib/domain";
import { allocationToRow, entryToRow, termFromPolicy } from "@/lib/db/mappers";
import { coverageLines, ledgerEntries, paymentAllocations, policies, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import type { AddCoverageField, AddCoverageInput } from "./inputs";
import { loadPolicyLedger, type PolicyLedger } from "./ledger-state";
import type { Reader } from "./read-models";
import { getDb } from "@/lib/db/read";
import type { ServiceFailure } from "./result";

/** A rejection, with the form field it belongs to when there is one. */
export type AddCoverageFailure = ServiceFailure & { field?: AddCoverageField };
export type AddCoverageResult<T> = { ok: true; value: T } | AddCoverageFailure;

const FIELD_FOR_CODE: Record<string, AddCoverageField> = {
  EFFECTIVE_DATE_OUTSIDE_TERM: "effectiveDate",
  DUPLICATE_COVERAGE_NAME: "name",
  INVALID_COVERAGE_NAME: "name",
};

function rejection(code: string, message: string): AddCoverageFailure {
  const field = FIELD_FOR_CODE[code];
  return field ? { ok: false, code, message, field } : { ok: false, code, message };
}

const OUTSIDE_TERM_MESSAGE = (term: Term) =>
  `Effective date must be on or after ${term.start} and before ${term.end} (the term end is excluded).`;

function plan(
  policy: { termStart: string; termEnd: string; status: "active" | "cancelled" },
  state: PolicyLedger,
  input: AddCoverageInput,
  coverageLineId: string,
): { term: Term; result: AddCoverageResult<PlanAddCoverageValue> } {
  const term = termFromPolicy(policy);
  const r = planAddCoverage({
    existingNames: state.existingNames,
    entries: state.entries,
    allocations: state.allocations,
    payments: state.payments,
    term,
    name: input.name,
    coverageLineId,
    limitCents: input.limitCents,
    rateBps: input.rateBps,
    effectiveDate: input.effectiveDate,
    date: input.transactionDate,
    policyCancelled: policy.status === "cancelled",
    newId: randomUUID,
  });
  if (r.ok) return { term, result: r };
  const message = r.code === "EFFECTIVE_DATE_OUTSIDE_TERM" ? OUTSIDE_TERM_MESSAGE(term) : r.message;
  return { term, result: rejection(r.code, message) };
}

export type AddCoveragePreview = {
  term: Term;
  plan: PlanAddCoverageValue;
  /** The calculation rows, exactly as the statement will show them. */
  explanation: ChargeExplanation;
};

/** What the review page shows. Read only; the command recomputes and never trusts this. */
export async function previewAddCoverage(
  brokerId: string,
  policyId: string,
  input: AddCoverageInput,
  r?: Reader,
): Promise<AddCoverageResult<AddCoveragePreview>> {
  const db = r ?? (getDb() as unknown as Reader);
  const [policy] = await db
    .select({ termStart: policies.termStart, termEnd: policies.termEnd, status: policies.status })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, brokerId)));
  if (!policy) return rejection("POLICY_NOT_FOUND", "Policy not found.");
  const { term, result } = plan(policy, await loadPolicyLedger(db, policyId), input, "preview");
  if (!result.ok) return result;
  const [charge] = result.value.entries;
  return {
    ok: true,
    value: {
      term,
      plan: result.value,
      explanation: explainCharge({ limitCents: input.limitCents, rateBps: input.rateBps, term, charge }),
    },
  };
}

export type AddedCoverage = {
  policyId: string;
  coverageLineId: string;
  chargeId: string;
  /** True when this request id was already recorded on this policy (double submit). */
  alreadyAdded: boolean;
};

export async function addCoverageCommand(
  tx: Tx,
  broker: { brokerId: string; clerkUserId: string },
  policyId: string,
  requestId: string,
  input: AddCoverageInput,
): Promise<AddCoverageResult<AddedCoverage>> {
  // 1. Lock the policy; it must belong to this broker. Serialises every write on it.
  const [policy] = await tx
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.brokerId, broker.brokerId)))
    .for("update");
  if (!policy) return rejection("POLICY_NOT_FOUND", "Policy not found.");

  // 2. Double submit: the request id is the coverage line id.
  const [prior] = await tx
    .select({ policyId: coverageLines.policyId })
    .from(coverageLines)
    .where(eq(coverageLines.id, requestId));
  if (prior) {
    if (prior.policyId !== policyId) {
      return rejection("REQUEST_ID_CONFLICT", "This request was already used for another policy. Start again.");
    }
    const [charge] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.coverageLineId, requestId), eq(ledgerEntries.type, "CHARGE")))
      .orderBy(ledgerEntries.seq)
      .limit(1);
    if (!charge) throw new Error(`coverage line ${requestId} has no charge`);
    return { ok: true, value: { policyId, coverageLineId: requestId, chargeId: charge.id, alreadyAdded: true } };
  }

  // 3. Plan from the locked state.
  const state = await loadPolicyLedger(tx as unknown as Reader, policyId);
  const { result } = plan(policy, state, input, requestId);
  if (!result.ok) return result;
  const p = result.value;
  const [charge] = p.entries;

  // 4. Event, line, charge, allocations: every row carries the event id.
  const eventId = randomUUID();
  await tx.insert(policyEvents).values({
    id: eventId,
    policyId,
    type: "COVERAGE_ADDED",
    transactionDate: input.transactionDate,
    actorRole: "broker",
    actorUserId: broker.clerkUserId,
    payload: {
      coverageLineId: requestId,
      name: p.name,
      limitCents: input.limitCents,
      rateBps: input.rateBps,
      premiumCents: p.premiumCents,
      effectiveDate: input.effectiveDate,
      daysInEffect: p.daysInEffect,
      daysInTerm: p.daysInTerm,
      chargeCents: charge.amountCents,
    },
  });
  await tx.insert(coverageLines).values({
    id: requestId,
    policyId,
    eventId,
    name: p.name,
    limitCents: input.limitCents,
    rateBps: input.rateBps,
    premiumCents: p.premiumCents,
  });
  await tx.insert(ledgerEntries).values(entryToRow(charge, { policyId, eventId }));
  if (p.allocations.length > 0) {
    await tx.insert(paymentAllocations).values(p.allocations.map((a) => allocationToRow(a, { policyId, eventId })));
  }

  // 5. Defence in depth.
  assertInvariants({
    entries: [...state.entries, charge],
    allocations: [...state.allocations, ...p.allocations],
    payments: state.payments,
  });

  return { ok: true, value: { policyId, coverageLineId: requestId, chargeId: charge.id, alreadyAdded: false } };
}
