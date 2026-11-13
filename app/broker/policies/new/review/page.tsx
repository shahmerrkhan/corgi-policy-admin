import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmIssueForm } from "@/components/confirm-issue-form";
import { DateCell } from "@/components/date-cell";
import { IssuePolicyForm } from "@/components/issue-policy-form";
import { MoneyCell } from "@/components/money-cell";
import { brokerPage } from "@/lib/auth/page";
import { parseIssuePolicyInput, str, type IssuePolicyField } from "@/lib/services/inputs";
import { previewIssue } from "@/lib/services/issue-policy";
import { getCustomerForBroker, listCustomersForBroker } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "Review policy · Policy Admin" };

const FIELDS: IssuePolicyField[] = ["customerId", "termStart", "transactionDate", "limit", "rateBps"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function ReviewPolicyPage({ searchParams }: PageProps<"/broker/policies/new/review">) {
  const actor = await brokerPage();
  const q = await searchParams;
  const raw = Object.fromEntries(FIELDS.map((f) => [f, str(q, f)])) as Record<IssuePolicyField, string>;

  const parsed = parseIssuePolicyInput(raw);
  const customer = parsed.ok ? await getCustomerForBroker(actor.brokerId, parsed.value.customerId) : null;
  const preview = parsed.ok ? previewIssue(parsed.value) : null;

  if (!parsed.ok || !customer || !preview?.ok) {
    const errors = parsed.ok
      ? !customer
        ? { customerId: "Choose one of your customers." }
        : { termStart: preview && !preview.ok ? preview.message : "Check the term start." }
      : parsed.errors;
    return (
      <>
        <h1 className="text-xl font-semibold">Issue policy</h1>
        <IssuePolicyForm customers={await listCustomersForBroker(actor.brokerId)} values={raw} errors={errors} />
      </>
    );
  }

  const { value: input } = parsed;
  const { term, premiumCents, chargeCents } = preview.value;
  const editHref = `/broker/policies/new?${new URLSearchParams(raw).toString()}`;

  return (
    <>
      <h1 className="text-xl font-semibold">Review policy</h1>
      <p className="text-sm text-muted-foreground">Nothing is saved until you confirm.</p>
      <dl className="max-w-xl text-sm">
        <Row label="Customer">{customer.legalName}</Row>
        <Row label="Term">
          <DateCell date={term.start} /> to <DateCell date={term.end} /> (end excluded)
        </Row>
        <Row label="Days in term">
          <span className="font-mono">{term.days}</span>
        </Row>
        <Row label="Transaction date">
          <DateCell date={input.transactionDate} />
        </Row>
        <Row label="Limit">
          <MoneyCell cents={input.limitCents} />
        </Row>
        <Row label="Rate">
          <span className="font-mono">{input.rateBps} bps</span>
        </Row>
        <Row label="Premium (limit x rate / 10000)">
          <MoneyCell cents={premiumCents} className="font-semibold" />
        </Row>
        <Row label="Charge posted (effective term start)">
          <MoneyCell cents={chargeCents} />
        </Row>
      </dl>
      <ConfirmIssueForm fields={raw} />
      <Link href={editHref} className="text-sm text-accent underline-offset-2 hover:underline">
        Edit details
      </Link>
    </>
  );
}
