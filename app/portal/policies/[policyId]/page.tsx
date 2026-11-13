import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDetail } from "@/components/policy-detail";
import { policyholderPage } from "@/lib/auth/page";
import { isUuid } from "@/lib/services/inputs";
import { getStatementForCustomer } from "@/lib/services/statement";

export const metadata: Metadata = { title: "My policy · Policy Admin" };

export default async function PortalPolicyPage({ params }: PageProps<"/portal/policies/[policyId]">) {
  const actor = await policyholderPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  // Scoped by the session's customer id, never the URL: another customer's policy is a 404.
  const statement = await getStatementForCustomer(actor.customerId, policyId);
  if (!statement) notFound();
  return <PolicyDetail statement={statement} />;
}
