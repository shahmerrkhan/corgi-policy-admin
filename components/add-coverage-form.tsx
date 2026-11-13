import { ErrorState } from "@/components/error-state";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AddCoverageField, FieldErrors } from "@/lib/services/inputs";

type AddCoverageFormProps = {
  policyId: string;
  values: Partial<Record<AddCoverageField, string>>;
  errors?: FieldErrors<AddCoverageField>;
};

// Step 1 of adding coverage: a plain GET form to the review page, which shows the charge.
// Nothing is written until Confirm on the review page.
export function AddCoverageForm({ policyId, values, errors = {} }: AddCoverageFormProps) {
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form
      method="get"
      action={`/broker/policies/${policyId}/coverage/new/review`}
      className="flex flex-col gap-6"
      noValidate
    >
      {hasErrors ? <ErrorState title="Check the highlighted fields" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Coverage name" hint="Unique on this policy." error={errors.name} className="sm:col-span-2">
          <Input name="name" maxLength={100} placeholder="Liquor Liability" defaultValue={values.name} required />
        </Field>
        <Field id="limit" label="Limit (dollars)" hint="$1,000 to $100,000,000." error={errors.limit}>
          <Input name="limit" inputMode="decimal" placeholder="73,000" defaultValue={values.limit} required />
        </Field>
        <Field id="rateBps" label="Rate (bps per term)" hint="Whole number, 1 to 10000. Defaults to the policy rate." error={errors.rateBps}>
          <Input name="rateBps" inputMode="numeric" placeholder="100" defaultValue={values.rateBps} required />
        </Field>
        <Field id="effectiveDate" label="Effective date" hint="On or after the term start, before the term end." error={errors.effectiveDate}>
          <Input name="effectiveDate" type="date" defaultValue={values.effectiveDate} required />
        </Field>
        <Field
          id="transactionDate"
          label="Transaction date"
          hint="Posting date of the charge. Defaults to today (Toronto)."
          error={errors.transactionDate}
        >
          <Input name="transactionDate" type="date" defaultValue={values.transactionDate} required />
        </Field>
      </div>
      <div>
        <Button type="submit">Review charge</Button>
      </div>
    </form>
  );
}
