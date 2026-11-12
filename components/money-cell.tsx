import { cn } from "@/lib/utils";
import { formatBalance, formatCents } from "@/lib/format/money";

type MoneyCellProps = {
  cents: number;
  /** amount: signed amount (-$12.00). balance: credits shown as (12.00) CR. */
  variant?: "amount" | "balance";
  className?: string;
};

export function MoneyCell({ cents, variant = "amount", className }: MoneyCellProps) {
  const text = variant === "balance" ? formatBalance(cents) : formatCents(cents);
  return (
    <span
      data-slot="money-cell"
      data-variant={variant}
      className={cn("block text-right font-mono whitespace-nowrap", className)}
    >
      {text}
    </span>
  );
}
