import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateCell } from "@/components/date-cell";
import { MoneyCell } from "@/components/money-cell";
import { PoliciesTable } from "@/components/policies-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brokerPage } from "@/lib/auth/page";
import { isUuid } from "@/lib/services/inputs";
import { getPolicyForBroker } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "Policy · Policy Admin" };

const EVENT_LABEL: Record<string, string> = { POLICY_ISSUED: "Policy issued" };
const ENTRY_LABEL: Record<string, string> = {
  CHARGE: "Charge",
  REVERSAL: "Reversal",
  CREDIT: "Credit",
  PAYMENT: "Payment",
  REFUND: "Refund",
};

// Minimal detail (step 5). The full statement and timeline arrive in step 6.
export default async function PolicyDetailPage({ params }: PageProps<"/broker/policies/[policyId]">) {
  const actor = await brokerPage();
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const detail = await getPolicyForBroker(actor.brokerId, policyId);
  if (!detail) notFound();

  return (
    <>
      <h1 className="text-xl font-semibold">
        Policy <span className="font-mono">{detail.policy.policyNumber}</span>
      </h1>
      <PoliciesTable policies={[detail.policy]} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Events</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction date</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.events.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <DateCell date={e.transactionDate} />
                </TableCell>
                <TableCell>{EVENT_LABEL[e.type] ?? e.type}</TableCell>
                <TableCell className="capitalize">{e.actorRole}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Ledger entries</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seq</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono">{e.seq}</TableCell>
                <TableCell>
                  <DateCell date={e.date} />
                </TableCell>
                <TableCell>{ENTRY_LABEL[e.type] ?? e.type}</TableCell>
                <TableCell>
                  {e.type === "CHARGE" || e.type === "CREDIT" ? <DateCell date={e.effectiveDate} /> : null}
                </TableCell>
                <TableCell>
                  <MoneyCell cents={e.amountCents} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
