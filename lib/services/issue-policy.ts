// Issue policy command (step 5). One withTx: lock the customer, insert the policy, lock it,
// plan with the domain module, write POLICY_ISSUED and its CHARGE entry, nothing else.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  assertInvariants,
  chargeForEffectiveDate,
  makeTerm,
  planCharge,
  premiumCents,
  type Term,
} from "@/lib/domain";
import { allocationFromRow, entryFromRow, entryToRow, paymentFromRow, termFromPolicy } from "@/lib/db/mappers";
import { customers, ledgerEntries, paymentAllocations, payments, policies, policyEvents } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import { FEB29_MESSAGE, type IssuePolicyInput } from "./inputs";
import type { ServiceResult } from "./result";

export type IssuePreview = {
  term: Term;
  premiumCents: number;
  /** The CHARGE amount: effective on term start, so the full-term premium. */
  chargeCents: number;
};

/** What the review page shows. The command recomputes everything; this is never trusted. */
export function previewIssue(input: Pick<IssuePolicyInput, "termStart" | "limitCents" | "rateBps">): ServiceResult<IssuePreview> {
  const term = makeTerm(input.termStart);
  if (!term.ok) return { ok: false, code: term.code, message: FEB29_MESSAGE };
  const premium = premiumCents(input.limitCents, input.rateBps);
  return {
    ok: true,
    value: { term: term.value, premiumCents: premium, chargeCents: chargeForEffectiveDate(term.value, premium, term.value.start) },
  };
}

export type IssuedPolicy = {
  policyId: string;
  policyNumber: string;
  eventId: string;
  chargeId: string;
  premiumCents: number;
};

export async function issuePolicyCommand(
  tx: Tx,
  broker: { brokerId: string; clerkUserId: string },
  input: IssuePolicyInput,
): Promise<ServiceResult<IssuedPolicy>> {
  // 1. Lock the customer row (must belong to this broker).
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.brokerId, broker.brokerId)))
    .for("update");
  if (!customer) return { ok: false, code: "CUSTOMER_NOT_FOUND", message: "Customer not found." };

  // 2. Term and premium from the domain module.
  const termResult = makeTerm(input.termStart);
  if (!termResult.ok) return { ok: false, code: termResult.code, message: FEB29_MESSAGE };
  const term = termResult.value;
  const premium = premiumCents(input.limitCents, input.rateBps);

  // 3. Insert the policy, then 4. lock the new row (the documented command pattern).
  const policyId = randomUUID();
  await tx.insert(policies).values({
    id: policyId,
    customerId: customer.id,
    brokerId: broker.brokerId,
    termStart: term.start,
    termEnd: term.end,
    limitCents: input.limitCents,
    rateBps: input.rateBps,
    premiumCents: premium,
  });
  const [policy] = await tx.select().from(policies).where(eq(policies.id, policyId)).for("update");
  if (!policy) throw new Error(`policy ${policyId} missing after insert`);

  // 5. Ledger state (empty for a new policy, loaded to keep the pattern).
  const entries = (await tx.select().from(ledgerEntries).where(eq(ledgerEntries.policyId, policyId))).map(entryFromRow);
  const allocations = (
    await tx.select().from(paymentAllocations).where(eq(paymentAllocations.policyId, policyId))
  ).map(allocationFromRow);
  const paymentList = (await tx.select().from(payments).where(eq(payments.policyId, policyId))).map(paymentFromRow);

  // 6. Plan the CHARGE: effective on term start, full-term premium, seq from the domain.
  const plan = planCharge({
    term: termFromPolicy(policy),
    premiumCents: premium,
    effectiveDate: term.start,
    coverageLineId: null,
    date: input.transactionDate,
    policyCancelled: false,
    newId: randomUUID,
    entries,
    allocations,
    payments: paymentList,
  });
  if (!plan.ok) return { ok: false, code: plan.code, message: plan.message };
  if (plan.value.allocations.length > 0) throw new Error("a new policy cannot have allocations");
  const [charge] = plan.value.entries;

  // 7. The event, then 8. its one ledger entry.
  const eventId = randomUUID();
  await tx.insert(policyEvents).values({
    id: eventId,
    policyId,
    type: "POLICY_ISSUED",
    transactionDate: input.transactionDate,
    actorRole: "broker",
    actorUserId: broker.clerkUserId,
    payload: {
      customerId: customer.id,
      termStart: term.start,
      termEnd: term.end,
      limitCents: input.limitCents,
      rateBps: input.rateBps,
      premiumCents: premium,
    },
  });
  await tx.insert(ledgerEntries).values(entryToRow(charge, { policyId, eventId }));

  // 9. Defence in depth: the resulting state must satisfy every ledger invariant.
  assertInvariants({ entries: [...entries, charge], allocations, payments: paymentList });

  return {
    ok: true,
    value: { policyId, policyNumber: policy.policyNumber, eventId, chargeId: charge.id, premiumCents: premium },
  };
}
