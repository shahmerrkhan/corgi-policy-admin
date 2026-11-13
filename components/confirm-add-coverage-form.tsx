"use client";

import { useActionState } from "react";
import { addCoverage, type AddCoverageFormState } from "@/actions/broker";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

const initial: AddCoverageFormState = {};

type ConfirmAddCoverageFormProps = {
  /** The raw reviewed fields plus policyId and requestId. The action re-parses and recomputes. */
  fields: Record<string, string>;
};

export function ConfirmAddCoverageForm({ fields }: ConfirmAddCoverageFormProps) {
  const [state, action, pending] = useActionState(addCoverage, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.message ? <ErrorState title="Could not add the coverage" description={state.message} /> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Confirm and add coverage"}
        </Button>
      </div>
    </form>
  );
}
