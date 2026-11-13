import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { ChargeCalculation } from "@/components/charge-calculation";
import { ConfirmCorrectCoverageForm } from "@/components/confirm-correct-coverage-form";
import { CorrectCoverageForm } from "@/components/correct-coverage-form";
import { CorrectionComparison, correctionRows } from "@/components/correction-comparison";
import { CoverageHeading } from "@/components/coverage-heading";
import { DateCell } from "@/components/date-cell";
import { ErrorState } from "@/components/error-state";
import { InlineWarning } from "@/components/inline-warning";
import { MoneyCell } from "@/components/money-cell";
import { brokerPage } from "@/lib/auth/page";
import { loadLineForCorrection, previewCoverageCorrection } from "@/lib/services/correct-coverage";
import { isUuid, parseCorrectCoverageInput, str, type CorrectCoverageField } from "@/lib/services/inputs";
import { getPolicySummaryForBroker } from "@/lib/services/read-models";
import { balanceSummary } from "@/lib/services/statement-view";

export const metadata: Metadata = { title: "Review correction · Policy Admin" };

const FIELDS: CorrectCoverageField[] = ["newEffectiveDate", "transactionDate", "reason"];

function BalanceLine({ label, cents }: { label: string; cents: number }) {
  const b = balanceSummary(cents);
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
      <dt className="text-muted-foreground">
        {label} ({b.kind === "due" ? "balance due" : "credit"})
      </dt>
      <dd>
        <MoneyCell cents={b.cents} />
      </dd>
    </div>
  );
}

export default async function ReviewCorrectionPage({
  params,
  searchParams,
}: PageProps<"/broker/policies/[policyId]/coverage/[lineId]/correct/review">) {
  const actor = await brokerPage();
  const { policyId, lineId } = await params;
  if (!isUuid(policyId) || !isUuid(lineId)) notFound();
  const policy = await getPolicySummaryForBroker(actor.brokerId, policyId);
  if (!policy) notFound();
  const found = await loadLineForCorrection(actor.brokerId, policyId, lineId);
  if (!found) notFound();

  const q = await searchParams;
  const raw = Object.fromEntries(FIELDS.map((f) => [f, str(q, f)])) as Record<CorrectCoverageField, string>;
  const heading = <CoverageHeading policy={policy} title={`Correct effective date · ${found.line.name}`} />;
  if (!found.charge || policy.status === "cancelled") {
    return (
      <>
        {heading}
        <ErrorState title="This line cannot be corrected" description="The policy is cancelled or the line has no single live charge." />
      </>
    );
  }

  const target = { coverageLineId: lineId, expectedChargeId: found.charge.id };
  const parsed = parseCorrectCoverageInput(raw);
  const preview = parsed.ok ? await previewCoverageCorrection(actor.brokerId, policyId, target, parsed.value) : null;

  if (!parsed.ok || !preview?.ok) {
    const failure = preview && !preview.ok ? preview : null;
    const errors = parsed.ok ? (failure?.field ? { [failure.field]: failure.message } : {}) : parsed.errors;
    return (
      <>
        {heading}
        {failure && !failure.field ? <ErrorState title="Coverage cannot be corrected" description={failure.message} /> : null}
        <CorrectCoverageForm
          action={`/broker/policies/${policyId}/coverage/${lineId}/correct/review`}
          currentEffectiveDate={found.charge.effectiveDate}
          values={raw}
          errors={errors}
        />
      </>
    );
  }

  const input = parsed.value;
  const { plan, oldExplanation, newExplanation, line } = preview.value;
  const rows = correctionRows({
    oldEffectiveDate: plan.original.effectiveDate,
    newEffectiveDate: plan.rebook.effectiveDate,
    oldDays: plan.oldDaysInEffect,
    newDays: plan.newDaysInEffect,
    daysInTerm: plan.daysInTerm,
    premiumCents: plan.original.premiumCents,
    oldChargeCents: plan.original.amountCents,
    newChargeCents: plan.rebook.amountCents,
  });
  const editHref = `/broker/policies/${policyId}/coverage/${lineId}/correct?${new URLSearchParams(raw).toString()}`;
  // One id per render of this page: the correction event's id. Confirming twice with the
  // same id writes once (see correctCoverageCommand).
  const requestId = randomUUID();

  return (
    <>
      {heading}
      <p className="text-sm text-muted-foreground">
        Nothing is saved until you confirm. The original charge stays on the statement; a reversal and a new charge are
        posted on <DateCell date={input.transactionDate} />.
      </p>
      {plan.backdatedOver30Days ? (
        <InlineWarning title="New effective date is more than 30 days before the transaction date">
          Backdating is allowed. Check the date <span className="font-mono">{input.newEffectiveDate}</span> before confirming.
        </InlineWarning>
      ) : null}
      <CorrectionComparison rows={rows} />
      <dl className="max-w-xl text-sm">
        <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="min-w-0 text-right break-words">{plan.reason}</dd>
        </div>
        <BalanceLine label="Before" cents={plan.balanceBeforeCents} />
        <BalanceLine label="After" cents={plan.balanceAfterCents} />
      </dl>
      <section aria-labelledby="old-calc" className="flex max-w-xl flex-col gap-1">
        <h2 id="old-calc" className="text-lg font-semibold">
          Old charge (reversed)
        </h2>
        <ChargeCalculation calc={{ ...oldExplanation, source: line.name }} />
      </section>
      <section aria-labelledby="new-calc" className="flex max-w-xl flex-col gap-1">
        <h2 id="new-calc" className="text-lg font-semibold">
          New charge
        </h2>
        <ChargeCalculation calc={{ ...newExplanation, source: line.name }} />
      </section>
      <ConfirmCorrectCoverageForm
        fields={{ ...raw, policyId, coverageLineId: lineId, expectedChargeId: found.charge.id, requestId }}
      />
      <Link href={editHref} className="text-sm text-accent underline-offset-2 hover:underline">
        Edit details
      </Link>
    </>
  );
}
