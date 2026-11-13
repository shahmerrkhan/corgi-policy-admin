import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PoliciesTable } from "@/components/policies-table";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brokerPage } from "@/lib/auth/page";
import { listCustomersForBroker, listPoliciesForBroker } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "Broker · Policy Admin" };

export default async function BrokerHome() {
  const actor = await brokerPage();
  const [customerList, policyList] = await Promise.all([
    listCustomersForBroker(actor.brokerId),
    listPoliciesForBroker(actor.brokerId),
  ]);

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Customers</h1>
          <Button asChild variant="secondary">
            <Link href="/broker/customers/new">New customer</Link>
          </Button>
        </div>
        {customerList.length === 0 ? (
          <EmptyState title="No customers yet" description="Create a customer to issue their first policy." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Legal name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerList.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.legalName}</TableCell>
                  <TableCell>{c.contactName}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>
                    {c.city}, {c.region}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/broker/policies/new?customerId=${c.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Issue policy
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Policies</h2>
        {policyList.length === 0 ? (
          <EmptyState title="No policies yet" description="Issued policies appear here." />
        ) : (
          <PoliciesTable policies={policyList} hrefBase="/broker/policies" />
        )}
      </section>
    </>
  );
}
