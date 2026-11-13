import { formatCents, formatInteger } from "@/lib/format/money";
import { cn } from "@/lib/utils";

// Old / New / Net comparison for an effective-date correction. Every number is passed in
// from lib/domain; this only formats. A real table at md and up; below md each row stacks
// (label, then the three values in a 3-column grid) so nothing scrolls sideways at 390px.

export type ComparisonRow = {
  label: string;
  old: string;
  new: string;
  net: string;
};

function signed(n: number, format: (v: number) => string): string {
  if (n === 0) return format(0);
  return n > 0 ? `+${format(n)}` : format(n);
}

export function correctionRows(input: {
  oldEffectiveDate: string;
  newEffectiveDate: string;
  oldDays: number;
  newDays: number;
  daysInTerm: number;
  premiumCents: number;
  oldChargeCents: number;
  newChargeCents: number;
}): ComparisonRow[] {
  const days = (n: number) => formatInteger(n);
  return [
    { label: "Effective date", old: input.oldEffectiveDate, new: input.newEffectiveDate, net: "" },
    { label: "Days in effect", old: days(input.oldDays), new: days(input.newDays), net: signed(input.newDays - input.oldDays, days) },
    { label: "Days in term", old: days(input.daysInTerm), new: days(input.daysInTerm), net: "" },
    { label: "Annual premium", old: formatCents(input.premiumCents), new: formatCents(input.premiumCents), net: "" },
    {
      label: "Charge",
      old: formatCents(input.oldChargeCents),
      new: formatCents(input.newChargeCents),
      net: signed(input.newChargeCents - input.oldChargeCents, formatCents),
    },
  ];
}

const COLS = ["Old", "New", "Net"] as const;

export function CorrectionComparison({ rows }: { rows: ComparisonRow[] }) {
  return (
    <table data-slot="correction-comparison" className="w-full max-w-xl text-sm max-md:block">
      <thead className="max-md:sr-only">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 text-left text-xs font-normal text-muted-foreground">
            <span className="sr-only">Item</span>
          </th>
          {COLS.map((c) => (
            <th key={c} scope="col" className="py-2 text-right text-xs font-normal text-muted-foreground">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-md:block">
        {rows.map((r) => (
          <tr
            key={r.label}
            data-row={r.label}
            className="border-b border-border max-md:grid max-md:grid-cols-3 max-md:gap-x-3 max-md:py-2"
          >
            <th scope="row" className="py-2 text-left font-normal text-muted-foreground max-md:col-span-3 max-md:py-0">
              {r.label}
            </th>
            {COLS.map((c) => {
              const value = c === "Old" ? r.old : c === "New" ? r.new : r.net;
              return (
                <td key={c} className={cn("py-2 text-right font-mono max-md:py-0", c === "Net" && "font-semibold")}>
                  <span className="mr-1 font-sans text-xs font-normal text-muted-foreground md:hidden">{c}</span>
                  {value || <span className="text-muted-foreground">–</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
