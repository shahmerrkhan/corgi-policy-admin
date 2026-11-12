import { cn } from "@/lib/utils";

type MonoIdProps = {
  prefix: string;
  value: string;
  className?: string;
};

export function MonoId({ prefix, value, className }: MonoIdProps) {
  return (
    <span data-slot="mono-id" className={cn("font-mono whitespace-nowrap", className)}>
      <span className="text-muted-foreground">{prefix}</span>
      {value}
    </span>
  );
}
