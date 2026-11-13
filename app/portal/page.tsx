import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PoliciesTable } from "@/components/policies-table";
import { policyholderPage } from "@/lib/auth/page";
import { listPoliciesForCustomer } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "My policies · Policy Admin" };

export default async function PortalPage() {
  // The customer id comes from the session link, never from the URL.
  const actor = await policyholderPage();
  const policies = await listPoliciesForCustomer(actor.customerId);
  return (
    <>
      <h1 className="text-xl font-semibold">My policies</h1>
      {policies.length === 0 ? (
        <EmptyState title="No policies yet" description="Policies your broker issues appear here." />
      ) : (
        <PoliciesTable policies={policies} hrefBase="/portal/policies" showCustomer={false} />
      )}
    </>
  );
}
