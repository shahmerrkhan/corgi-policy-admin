import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PolicyDetail } from "@/components/policy-detail";
import { Button } from "@/components/ui/button";
import { brokerPage } from "@/lib/auth/page";
import { isUuid } from "@/lib/services/inputs";
import { getStatementForBroker } from "@/lib/services/statement";

export const metadata: Metadata = { title: "Policy · Policy Admin" };

export default async function BrokerPolicyPage({ params }: PageProps<"/broker/policies/[policyId]">) {
  const actor = await brokerPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  // Scoped by the session's broker id: another broker's policy is a 404.
  const statement = await getStatementForBroker(actor.brokerId, policyId);
  if (!statement) notFound();
  const actions =
    statement.policy.status === "active" ? (
      <Button asChild variant="secondary">
        <Link href={`/broker/policies/${policyId}/coverage/new`}>Add coverage</Link>
      </Button>
    ) : undefined;
  return <PolicyDetail statement={statement} actions={actions} />;
}
