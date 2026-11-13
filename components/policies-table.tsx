import Link from "next/link";
import { DateCell } from "@/components/date-cell";
import { MoneyCell } from "@/components/money-cell";
import { Tag } from "@/components/tag";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PolicyListItem } from "@/lib/services/read-models";

type PoliciesTableProps = {
  policies: PolicyListItem[];
  /** Link each policy number to this base path (omit for no links). */
  hrefBase?: string;
  showCustomer?: boolean;
};

export function PoliciesTable({ policies, hrefBase, showCustomer = true }: PoliciesTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Policy</TableHead>
          {showCustomer ? <TableHead>Customer</TableHead> : null}
          <TableHead>Term start</TableHead>
          <TableHead>Term end</TableHead>
          <TableHead className="text-right">Limit</TableHead>
          <TableHead className="text-right">Rate (bps)</TableHead>
          <TableHead className="text-right">Premium</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {policies.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              {hrefBase ? (
                <Link href={`${hrefBase}/${p.id}`} className="font-mono text-accent underline-offset-2 hover:underline">
                  {p.policyNumber}
                </Link>
              ) : (
                <span className="font-mono">{p.policyNumber}</span>
              )}
            </TableCell>
            {showCustomer ? <TableCell>{p.customerName}</TableCell> : null}
            <TableCell>
              <DateCell date={p.termStart} />
            </TableCell>
            <TableCell>
              <DateCell date={p.termEnd} />
            </TableCell>
            <TableCell>
              <MoneyCell cents={p.limitCents} />
            </TableCell>
            <TableCell className="text-right font-mono">{p.rateBps}</TableCell>
            <TableCell>
              <MoneyCell cents={p.premiumCents} />
            </TableCell>
            <TableCell>
              <Tag>{p.status === "active" ? "Active" : "Cancelled"}</Tag>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
