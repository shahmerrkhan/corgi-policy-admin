import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateCell } from "@/components/date-cell";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Field } from "@/components/field";
import { InlineWarning } from "@/components/inline-warning";
import { MoneyCell } from "@/components/money-cell";
import { MonoId } from "@/components/mono-id";
import { StatusBadge } from "@/components/status-badge";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// Dev-only primitive gallery. 404 in production builds; never linked from the app.
export const metadata: Metadata = {
  title: "UI primitives (dev)",
  robots: { index: false, follow: false },
};

const ROWS = [
  { id: "000123", date: "2026-02-22", type: "Charge", cents: 123456, balance: 123456, tag: null },
  { id: "000124", date: "2026-03-01", type: "Payment", cents: -100000, balance: 23456, tag: null },
  { id: "000125", date: "2026-03-15", type: "Reversal", cents: -123456, balance: -100000, tag: "Correction" },
  { id: "000126", date: "2026-03-15", type: "Charge", cents: 61200, balance: -38800, tag: "Correction" },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border-strong pb-1 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6">
      <h1 className="text-xl font-semibold">UI primitives</h1>

      <Section title="Type scale">
        <p className="text-xs">text-xs 12px: The quick brown fox 0123456789</p>
        <p className="text-sm">text-sm 13px (body): The quick brown fox 0123456789</p>
        <p className="text-base">text-base 14px: The quick brown fox 0123456789</p>
        <p className="text-lg">text-lg 16px: The quick brown fox 0123456789</p>
        <p className="text-xl">text-xl 20px: The quick brown fox 0123456789</p>
        <p className="font-mono">Plex Mono: POL-000123 $1,234.56</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Primary sm</Button>
          <Button size="sm" variant="secondary">
            Secondary sm
          </Button>
          <Button size="sm" variant="destructive">
            Destructive sm
          </Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="limit" label="Limit" hint="Whole dollars, per occurrence.">
            <Input placeholder="1,000,000" />
          </Field>
          <Field id="rate" label="Rate (bps)" error="Rate must be a whole number of basis points.">
            <Input defaultValue="12.5" />
          </Field>
          <Field id="reason" label="Reason" hint="Shown in the policy history.">
            <Textarea placeholder="Insured requested cancellation" />
          </Field>
          <Field id="coverage" label="Coverage line">
            <Select>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a coverage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gl">General liability</SelectItem>
                <SelectItem value="products">Products and completed operations</SelectItem>
                <SelectItem value="medical">Medical payments</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Status, tags, IDs, dates">
        <div className="flex flex-wrap items-center gap-4">
          <StatusBadge status="pending" />
          <StatusBadge status="succeeded" />
          <StatusBadge status="failed" />
          <Tag>Correction</Tag>
          <Tag>Reversal</Tag>
          <MonoId prefix="POL-" value="000123" />
          <MonoId prefix="pi_" value="3QxYz8Lk2" />
          <DateCell date="2026-02-22" />
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <MonoId prefix="LE-" value={r.id} />
                </TableCell>
                <TableCell>
                  <DateCell date={r.date} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    {r.type}
                    {r.tag ? <Tag>{r.tag}</Tag> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <MoneyCell cents={r.cents} />
                </TableCell>
                <TableCell>
                  <MoneyCell cents={r.balance} variant="balance" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Messages">
        <InlineWarning title="Cancellation date is more than 30 days before today.">
          Check the date before confirming.
        </InlineWarning>
        <EmptyState
          title="No payments yet"
          description="Payments appear here once the policyholder pays."
          action={<Button variant="secondary">Back to policy</Button>}
        />
        <ErrorState
          title="Could not load the ledger"
          description="The database did not respond. Try again."
          action={<Button variant="secondary">Retry</Button>}
        />
      </Section>
    </main>
  );
}
