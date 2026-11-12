import { cn } from "@/lib/utils";

type DateCellProps = {
  /** Plain YYYY-MM-DD string, rendered as-is (ISO) for tables. */
  date: string;
  className?: string;
};

export function DateCell({ date, className }: DateCellProps) {
  return (
    <time
      dateTime={date}
      data-slot="date-cell"
      className={cn("font-mono whitespace-nowrap", className)}
    >
      {date}
    </time>
  );
}
