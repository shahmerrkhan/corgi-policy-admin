import { ErrorState } from "@/components/error-state";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CorrectCoverageField, FieldErrors } from "@/lib/services/inputs";

type CorrectCoverageFormProps = {
  action: string;
  currentEffectiveDate: string;
  values: Partial<Record<CorrectCoverageField, string>>;
  errors?: FieldErrors<CorrectCoverageField>;
};

// Step 1 of a correction: a plain GET form to the review page (old / new / net).
// Nothing is written until Confirm on the review page.
export function CorrectCoverageForm({ action, currentEffectiveDate, values, errors = {} }: CorrectCoverageFormProps) {
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form method="get" action={action} className="flex flex-col gap-6" noValidate>
      {hasErrors ? <ErrorState title="Check the highlighted fields" /> : null}
      <p className="text-sm">
        Current effective date <span className="font-mono">{currentEffectiveDate}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="newEffectiveDate"
          label="New effective date"
          hint="Inside the term and different from the current date."
          error={errors.newEffectiveDate}
        >
          <Input name="newEffectiveDate" type="date" defaultValue={values.newEffectiveDate} required />
        </Field>
        <Field
          id="transactionDate"
          label="Transaction date"
          hint="Posting date of the reversal and new charge. Not before the latest ledger entry."
          error={errors.transactionDate}
        >
          <Input name="transactionDate" type="date" defaultValue={values.transactionDate} required />
        </Field>
        <Field id="reason" label="Reason" hint="Required, up to 500 characters." error={errors.reason} className="sm:col-span-2">
          <Textarea name="reason" maxLength={500} rows={3} defaultValue={values.reason} required />
        </Field>
      </div>
      <div>
        <Button type="submit">Review correction</Button>
      </div>
    </form>
  );
}
