import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDetail } from "@/components/policy-detail";
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
  return <PolicyDetail statement={statement} />;
}
