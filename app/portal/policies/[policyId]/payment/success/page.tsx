import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineWarning } from "@/components/inline-warning";
import { PolicyDetail } from "@/components/policy-detail";
import { policyholderPage } from "@/lib/auth/page";
import { isUuid } from "@/lib/services/inputs";
import { getStatementForCustomer } from "@/lib/services/statement";

export const metadata: Metadata = { title: "Payment processing · Policy Admin" };

// Stripe returns here after Checkout. This page never writes and never calls Stripe: only
// the webhook records a payment, so it may not show in the statement for a few seconds.
export default async function PaymentSuccessPage({ params }: PageProps<"/portal/policies/[policyId]/payment/success">) {
  const actor = await policyholderPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const statement = await getStatementForCustomer(actor.customerId, policyId);
  if (!statement) notFound();
  return (
    <>
      <InlineWarning title="Payment processing">
        Stripe has your payment. It appears in the statement once Stripe confirms it, usually within a few
        seconds.{" "}
        <Link href={`/portal/policies/${policyId}/payment/success`} className="underline underline-offset-2">
          Refresh
        </Link>{" "}
        or{" "}
        <Link href={`/portal/policies/${policyId}`} className="underline underline-offset-2">
          go back to the policy
        </Link>
        .
      </InlineWarning>
      <PolicyDetail statement={statement} />
    </>
  );
}
