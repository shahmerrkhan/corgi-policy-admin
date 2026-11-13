import { BalanceSummary } from "@/components/balance-summary";
import { LedgerTable } from "@/components/ledger-table";
import { PolicyTimeline } from "@/components/policy-timeline";
import { Tag } from "@/components/tag";
import { formatCents } from "@/lib/format/money";
import type { PolicyStatement } from "@/lib/services/statement-view";

// One policy's header, statement and timeline. Shared by the broker and portal pages;
// each page loads the statement with its own session-scoped read model. `actions` sits
// under the balance (the portal's Pay balance button); the broker page passes none.
export function PolicyDetail({ statement, actions }: { statement: PolicyStatement; actions?: React.ReactNode }) {
  const { policy, rows, balance, events } = statement;
  return (
    <>
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold">
            <span>
              Policy <span className="font-mono">{policy.policyNumber}</span>
            </span>
            <Tag>{policy.status === "active" ? "Active" : "Cancelled"}</Tag>
          </h1>
          <p className="text-sm">{policy.customerName}</p>
          <p className="text-sm text-muted-foreground">
            Term <span className="font-mono">{policy.termStart}</span> to{" "}
            <span className="font-mono">{policy.termEnd}</span> · Limit{" "}
            <span className="font-mono">{formatCents(policy.limitCents)}</span> · Rate{" "}
            <span className="font-mono">{policy.rateBps}</span> bps · Premium{" "}
            <span className="font-mono">{formatCents(policy.premiumCents)}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <BalanceSummary balance={balance} />
          {actions}
        </div>
      </header>

      <section aria-labelledby="statement-heading" className="flex flex-col gap-3">
        <h2 id="statement-heading" className="text-lg font-semibold">
          Statement
        </h2>
        <LedgerTable rows={rows} />
      </section>

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
        <h2 id="timeline-heading" className="text-lg font-semibold">
          Timeline
        </h2>
        <PolicyTimeline events={events} />
      </section>
    </>
  );
}
