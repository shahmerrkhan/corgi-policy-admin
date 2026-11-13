import { InlineWarning } from "@/components/inline-warning";
import { formatCents, formatInteger } from "@/lib/format/money";
import type { RoundingStep } from "@/lib/domain";
import type { ChargeCalculation as Calc } from "@/lib/services/statement-view";

// Formatting only: every number here was computed by lib/domain (explainCharge).

function rounding(step: RoundingStep): string {
  if (step.remainder === 0) return "exact";
  const unit = `${formatInteger(step.quotient)} + ${formatInteger(step.remainder)}/${formatInteger(step.denominator)} cents`;
  return `${unit}, rounded half up (${step.roundedUp ? "up" : "down"}) once`;
}

function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 md:grid-cols-[12rem_1fr] md:gap-3">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-mono text-sm break-words whitespace-normal">{children}</dd>
    </div>
  );
}

export function ChargeCalculation({ calc }: { calc: Calc }) {
  const p = calc.proration;
  return (
    <div data-slot="charge-calculation" className="flex flex-col gap-2 py-2">
      <dl className="flex flex-col gap-1.5">
        <Line term={`Limit (${calc.source})`}>{formatCents(calc.limitCents)}</Line>
        <Line term="Rate (per term)">{formatInteger(calc.rateBps)} bps</Line>
        <Line term="Premium">
          {formatCents(calc.limitCents)} × {formatInteger(calc.rateBps)} ÷ 10,000 ={" "}
          {formatCents(calc.premium.resultCents)} ({rounding(calc.premium)})
        </Line>
        <Line term="Term days">{formatInteger(calc.termDays)}</Line>
        <Line term="Days in effect">{formatInteger(calc.daysInEffect)}</Line>
        {p ? (
          <Line term="Charge">
            {formatCents(calc.storedPremiumCents)} × {formatInteger(calc.daysInEffect)} ÷ {formatInteger(calc.termDays)} ={" "}
            {formatCents(p.resultCents)} ({rounding(p)})
          </Line>
        ) : null}
      </dl>
      {calc.matchesStored ? null : (
        <InlineWarning title="Calculation does not match the stored amount">
          Stored premium {formatCents(calc.storedPremiumCents)}, stored charge {formatCents(calc.storedAmountCents)}.{" "}
          {p
            ? `Recomputed: premium ${formatCents(calc.premium.resultCents)}, charge ${formatCents(p.resultCents)}.`
            : "The effective date is outside the term."}{" "}
          The statement uses the stored amount.
        </InlineWarning>
      )}
    </div>
  );
}
