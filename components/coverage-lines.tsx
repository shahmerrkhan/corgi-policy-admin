import Link from "next/link";
import { formatCents, formatInteger } from "@/lib/format/money";
import type { CoverageLineSummary } from "@/lib/services/statement-view";

type CoverageLinesProps = {
  lines: CoverageLineSummary[];
  /** Set only on the broker page for an active policy: shows "Correct date" per line. */
  correctHref?: (lineId: string) => string;
};

// Added coverage lines with their current effective date (from each line's live charge).
// A stacked list, not a table, so it never scrolls sideways at 390px.
export function CoverageLines({ lines, correctHref }: CoverageLinesProps) {
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="coverage-heading" className="flex flex-col gap-3">
      <h2 id="coverage-heading" className="text-lg font-semibold">
        Coverage lines
      </h2>
      <ul data-slot="coverage-lines" className="flex flex-col divide-y divide-border border-y border-border">
        {lines.map((line) => (
          <li key={line.id} data-line-id={line.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium break-words">{line.name}</span>
              <span className="text-muted-foreground">
                Limit <span className="font-mono">{formatCents(line.limitCents)}</span> · Rate{" "}
                <span className="font-mono">{formatInteger(line.rateBps)}</span> bps · Effective{" "}
                <span className="font-mono" data-slot="line-effective-date">
                  {line.effectiveDate ?? "unknown"}
                </span>
              </span>
            </div>
            {correctHref && line.liveChargeId ? (
              <Link href={correctHref(line.id)} className="text-accent underline-offset-2 hover:underline">
                Correct date<span className="sr-only"> for {line.name}</span>
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
