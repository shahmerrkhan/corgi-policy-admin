import { formatCents } from "@/lib/format/money";
import type { BalanceSummary as Summary } from "@/lib/services/statement-view";

export function BalanceSummary({ balance }: { balance: Summary }) {
  const label = balance.kind === "credit" ? "Credit" : "Balance due";
  return (
    <div
      data-slot="balance-summary"
      data-kind={balance.kind}
      className="flex flex-col gap-0.5 rounded-sm border border-border-strong bg-surface px-4 py-3"
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-xl font-semibold">{formatCents(balance.cents)}</span>
    </div>
  );
}
