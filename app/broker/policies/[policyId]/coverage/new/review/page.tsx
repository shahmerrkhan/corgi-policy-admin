import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AddCoverageForm } from "@/components/add-coverage-form";
import { ChargeCalculation } from "@/components/charge-calculation";
import { ConfirmAddCoverageForm } from "@/components/confirm-add-coverage-form";
import { CoverageHeading } from "@/components/coverage-heading";
import { DateCell } from "@/components/date-cell";
import { ErrorState } from "@/components/error-state";
import { InlineWarning } from "@/components/inline-warning";
import { MoneyCell } from "@/components/money-cell";
import { brokerPage } from "@/lib/auth/page";
import { previewAddCoverage } from "@/lib/services/add-coverage";
import { isUuid, parseAddCoverageInput, str, type AddCoverageField } from "@/lib/services/inputs";
import { getPolicySummaryForBroker } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "Review coverage · Policy Admin" };

const FIELDS: AddCoverageField[] = ["name", "limit", "rateBps", "effectiveDate", "transactionDate"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function ReviewCoveragePage({
  params,
  searchParams,
}: PageProps<"/broker/policies/[policyId]/coverage/new/review">) {
  const actor = await brokerPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const policy = await getPolicySummaryForBroker(actor.brokerId, policyId);
  if (!policy) notFound();

  const q = await searchParams;
  const raw = Object.fromEntries(FIELDS.map((f) => [f, str(q, f)])) as Record<AddCoverageField, string>;
  const parsed = parseAddCoverageInput(raw);
  const preview = parsed.ok ? await previewAddCoverage(actor.brokerId, policyId, parsed.value) : null;

  if (!parsed.ok || !preview?.ok) {
    const failure = preview && !preview.ok ? preview : null;
    const errors = parsed.ok ? (failure?.field ? { [failure.field]: failure.message } : {}) : parsed.errors;
    return (
      <>
        <CoverageHeading policy={policy} />
        {failure && !failure.field ? <ErrorState title="Coverage cannot be added" description={failure.message} /> : null}
        {policy.status === "active" ? <AddCoverageForm policyId={policyId} values={raw} errors={errors} /> : null}
      </>
    );
  }

  const input = parsed.value;
  const { plan, explanation } = preview.value;
  const [charge] = plan.entries;
  const appliedCents = plan.allocations.reduce((sum, a) => sum + a.amountCents, 0);
  const editHref = `/broker/policies/${policyId}/coverage/new?${new URLSearchParams(raw).toString()}`;
  // One id per render of this page: the new coverage line's id. Confirming twice with the
  // same id writes once (see addCoverageCommand).
  const requestId = randomUUID();

  return (
    <>
      <CoverageHeading policy={policy} />
      <p className="text-sm text-muted-foreground">Nothing is saved until you confirm.</p>
      {plan.backdatedOver30Days ? (
        <InlineWarning title="Effective date is more than 30 days before the transaction date">
          Backdating is allowed. Check the effective date <span className="font-mono">{input.effectiveDate}</span> before
          confirming.
        </InlineWarning>
      ) : null}
      <dl className="max-w-xl text-sm">
        <Row label="Coverage">{plan.name}</Row>
        <Row label="Effective date">
          <DateCell date={input.effectiveDate} />
        </Row>
        <Row label="Transaction date">
          <DateCell date={input.transactionDate} />
        </Row>
        <Row label="Annual premium">
          <MoneyCell cents={plan.premiumCents} />
        </Row>
        <Row label="Prorated charge">
          <MoneyCell cents={charge.amountCents} className="font-semibold" />
        </Row>
        {appliedCents > 0 ? (
          <Row label="Paid from credit on account">
            <MoneyCell cents={appliedCents} />
          </Row>
        ) : null}
      </dl>
      <section aria-labelledby="calculation-heading" className="flex max-w-xl flex-col gap-1">
        <h2 id="calculation-heading" className="text-lg font-semibold">
          Calculation
        </h2>
        <ChargeCalculation calc={{ ...explanation, source: plan.name }} />
      </section>
      <ConfirmAddCoverageForm fields={{ ...raw, policyId, requestId }} />
      <Link href={editHref} className="text-sm text-accent underline-offset-2 hover:underline">
        Edit details
      </Link>
    </>
  );
}
