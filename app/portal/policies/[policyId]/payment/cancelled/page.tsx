import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineWarning } from "@/components/inline-warning";
import { policyholderPage } from "@/lib/auth/page";
import { isUuid } from "@/lib/services/inputs";
import { getStatementForCustomer } from "@/lib/services/statement";

export const metadata: Metadata = { title: "Payment cancelled · Policy Admin" };

export default async function PaymentCancelledPage({ params }: PageProps<"/portal/policies/[policyId]/payment/cancelled">) {
  const actor = await policyholderPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const statement = await getStatementForCustomer(actor.customerId, policyId);
  if (!statement) notFound();
  return (
    <InlineWarning title="Payment cancelled">
      Nothing was charged.{" "}
      <Link href={`/portal/policies/${policyId}`} className="underline underline-offset-2">
        Back to policy <span className="font-mono">{statement.policy.policyNumber}</span>
      </Link>
      .
    </InlineWarning>
  );
}
