import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddCoverageForm } from "@/components/add-coverage-form";
import { CoverageHeading } from "@/components/coverage-heading";
import { ErrorState } from "@/components/error-state";
import { brokerPage } from "@/lib/auth/page";
import { isUuid, str } from "@/lib/services/inputs";
import { getPolicySummaryForBroker } from "@/lib/services/read-models";
import { todayIso } from "@/lib/services/today";

export const metadata: Metadata = { title: "Add coverage · Policy Admin" };

export default async function AddCoveragePage({ params, searchParams }: PageProps<"/broker/policies/[policyId]/coverage/new">) {
  const actor = await brokerPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const policy = await getPolicySummaryForBroker(actor.brokerId, policyId);
  if (!policy) notFound();
  const q = await searchParams;

  return (
    <>
      <CoverageHeading policy={policy} />
      {policy.status === "cancelled" ? (
        <ErrorState title="This policy is cancelled" description="Coverage cannot be added to a cancelled policy." />
      ) : (
        <AddCoverageForm
          policyId={policy.id}
          values={{
            name: str(q, "name"),
            limit: str(q, "limit"),
            rateBps: str(q, "rateBps") || String(policy.rateBps),
            effectiveDate: str(q, "effectiveDate"),
            transactionDate: str(q, "transactionDate") || todayIso(),
          }}
        />
      )}
      <Link href={`/broker/policies/${policy.id}`} className="text-sm text-accent underline-offset-2 hover:underline">
        Back to policy
      </Link>
    </>
  );
}
