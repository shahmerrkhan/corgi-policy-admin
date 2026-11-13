import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { IssuePolicyForm } from "@/components/issue-policy-form";
import { Button } from "@/components/ui/button";
import { brokerPage } from "@/lib/auth/page";
import { str } from "@/lib/services/inputs";
import { listCustomersForBroker } from "@/lib/services/read-models";
import { todayIso } from "@/lib/services/today";

export const metadata: Metadata = { title: "Issue policy · Policy Admin" };

export default async function NewPolicyPage({ searchParams }: PageProps<"/broker/policies/new">) {
  const actor = await brokerPage();
  const q = await searchParams;
  const customerList = await listCustomersForBroker(actor.brokerId);

  return (
    <>
      <h1 className="text-xl font-semibold">Issue policy</h1>
      {customerList.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Create a customer first."
          action={
            <Button asChild variant="secondary">
              <Link href="/broker/customers/new">New customer</Link>
            </Button>
          }
        />
      ) : (
        <IssuePolicyForm
          customers={customerList}
          values={{
            customerId: str(q, "customerId"),
            termStart: str(q, "termStart"),
            transactionDate: str(q, "transactionDate") || todayIso(),
            limit: str(q, "limit"),
            rateBps: str(q, "rateBps"),
          }}
        />
      )}
    </>
  );
}
