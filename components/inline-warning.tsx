import { cn } from "@/lib/utils";

type InlineWarningProps = {
  title: string;
  children?: React.ReactNode;
  className?: string;
};

export function InlineWarning({ title, children, className }: InlineWarningProps) {
  return (
    <div
      role="status"
      data-slot="inline-warning"
      className={cn("rounded-sm border border-pending bg-surface px-3 py-2 text-sm", className)}
    >
      <p className="font-medium text-pending">{title}</p>
      {children ? <div className="mt-0.5 text-foreground">{children}</div> : null}
    </div>
  );
}
