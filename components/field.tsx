import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

type FieldProps = {
  /** id of the control; used for the label and for the hint/error ids. */
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** A single form control element (Input, Textarea, SelectTrigger, ...). */
  children: React.ReactElement<ControlProps>;
  className?: string;
};

export function Field({ id, label, hint, error, children, className }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  });

  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
