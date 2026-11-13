"use client";

import { useActionState } from "react";
import { issuePolicy, type IssuePolicyFormState } from "@/actions/broker";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

const initial: IssuePolicyFormState = {};

type ConfirmIssueFormProps = {
  /** The raw reviewed fields. The action re-parses and recomputes everything. */
  fields: Record<string, string>;
};

export function ConfirmIssueForm({ fields }: ConfirmIssueFormProps) {
  const [state, action, pending] = useActionState(issuePolicy, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.message ? <ErrorState title="Could not issue the policy" description={state.message} /> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Issuing…" : "Confirm and issue policy"}
        </Button>
      </div>
    </form>
  );
}
