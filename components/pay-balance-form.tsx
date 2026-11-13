"use client";

import { useActionState } from "react";
import { startCheckout, type PayBalanceState } from "@/actions/portal";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format/money";

const initial: PayBalanceState = {};

type PayBalanceFormProps = {
  policyId: string;
  /** Display only. The server reads the balance from the ledger again when creating the session. */
  balanceCents: number;
};

export function PayBalanceForm({ policyId, balanceCents }: PayBalanceFormProps) {
  const [state, action, pending] = useActionState(startCheckout, initial);
  return (
    <form action={action} className="flex flex-col items-start gap-2 md:items-end">
      <input type="hidden" name="policyId" value={policyId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Opening Stripe…" : `Pay balance ${formatCents(balanceCents)}`}
      </Button>
      {state.message ? (
        <p role="alert" className="text-sm text-fail">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
