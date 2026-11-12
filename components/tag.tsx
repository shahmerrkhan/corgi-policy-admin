import { cn } from "@/lib/utils";

type TagProps = {
  children: React.ReactNode;
  className?: string;
};

export function Tag({ children, className }: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(
        "inline-flex h-5 items-center rounded-sm border border-accent px-1.5 text-xs font-medium tracking-wider text-accent uppercase",
        className
      )}
    >
      {children}
    </span>
  );
}
