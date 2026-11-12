import { cn } from "@/lib/utils";

export type PaymentStatus = "pending" | "succeeded" | "failed";

const STATUS: Record<PaymentStatus, { label: string; text: string; dot: string }> = {
  pending: { label: "Pending", text: "text-pending", dot: "bg-pending" },
  succeeded: { label: "Succeeded", text: "text-ok", dot: "bg-ok" },
  failed: { label: "Failed", text: "text-fail", dot: "bg-fail" },
};

type StatusBadgeProps = {
  status: PaymentStatus;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const s = STATUS[status];
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn("inline-flex items-center gap-1.5 text-sm font-medium", s.text, className)}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
