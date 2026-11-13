import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectCoverageForm } from "@/components/correct-coverage-form";
import { CoverageHeading } from "@/components/coverage-heading";
import { ErrorState } from "@/components/error-state";
import { brokerPage } from "@/lib/auth/page";
import { loadLineForCorrection } from "@/lib/services/correct-coverage";
import { isUuid, str } from "@/lib/services/inputs";
import { getPolicySummaryForBroker } from "@/lib/services/read-models";
import { todayIso } from "@/lib/services/today";

export const metadata: Metadata = { title: "Correct coverage date · Policy Admin" };

export default async function CorrectCoveragePage({
  params,
  searchParams,
}: PageProps<"/broker/policies/[policyId]/coverage/[lineId]/correct">) {
  const actor = await brokerPage();
  const { policyId, lineId } = await params;
  if (!isUuid(policyId) || !isUuid(lineId)) notFound();
  const policy = await getPolicySummaryForBroker(actor.brokerId, policyId);
  if (!policy) notFound();
  const found = await loadLineForCorrection(actor.brokerId, policyId, lineId);
  if (!found) notFound();
  const q = await searchParams;

  return (
    <>
      <CoverageHeading policy={policy} title={`Correct effective date · ${found.line.name}`} />
      {policy.status === "cancelled" ? (
        <ErrorState title="This policy is cancelled" description="Corrections are blocked on cancelled policies." />
      ) : !found.charge ? (
        <ErrorState title="This line cannot be corrected" description="Its ledger does not have exactly one live charge." />
      ) : (
        <CorrectCoverageForm
          action={`/broker/policies/${policyId}/coverage/${lineId}/correct/review`}
          currentEffectiveDate={found.charge.effectiveDate}
          values={{
            newEffectiveDate: str(q, "newEffectiveDate"),
            transactionDate: str(q, "transactionDate") || todayIso(),
            reason: str(q, "reason"),
          }}
        />
      )}
      <Link href={`/broker/policies/${policyId}`} className="text-sm text-accent underline-offset-2 hover:underline">
        Back to policy
      </Link>
    </>
  );
}
