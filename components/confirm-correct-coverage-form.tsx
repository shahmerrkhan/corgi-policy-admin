"use client";

import Link from "next/link";
import { useActionState } from "react";
import { correctCoverageDate, type CorrectCoverageFormState } from "@/actions/broker";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

const initial: CorrectCoverageFormState = {};

type ConfirmCorrectCoverageFormProps = {
  /** Reviewed fields plus policyId, coverageLineId, expectedChargeId and requestId. The action recomputes. */
  fields: Record<string, string>;
};

export function ConfirmCorrectCoverageForm({ fields }: ConfirmCorrectCoverageFormProps) {
  const [state, action, pending] = useActionState(correctCoverageDate, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.message ? (
        <ErrorState
          title="Could not correct the coverage"
          description={state.message}
          action={
            state.restartHref ? (
              <Link href={state.restartHref} className="text-sm text-accent underline-offset-2 hover:underline">
                Open the correction form
              </Link>
            ) : undefined
          }
        />
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Correcting…" : "Confirm correction"}
        </Button>
      </div>
    </form>
  );
}
