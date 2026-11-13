import type { PolicyListItem } from "@/lib/services/read-models";

// Title for the add-coverage pages: which policy and its term (end excluded).
export function CoverageHeading({ policy, title = "Add coverage" }: { policy: PolicyListItem; title?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        Policy <span className="font-mono">{policy.policyNumber}</span> · {policy.customerName} · Term{" "}
        <span className="font-mono">{policy.termStart}</span> to <span className="font-mono">{policy.termEnd}</span> (end
        excluded)
      </p>
    </div>
  );
}
