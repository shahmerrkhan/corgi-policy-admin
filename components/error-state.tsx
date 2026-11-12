import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn("rounded-sm border border-fail bg-surface px-6 py-8 text-center", className)}
    >
      <p className="text-base font-medium text-fail">{title}</p>
      {description ? <p className="mt-1 text-sm text-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
