import { CustomerSelect } from "@/components/customer-select";
import { ErrorState } from "@/components/error-state";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldErrors, IssuePolicyField } from "@/lib/services/inputs";

type IssuePolicyFormProps = {
  customers: { id: string; legalName: string }[];
  values: Partial<Record<IssuePolicyField, string>>;
  errors?: FieldErrors<IssuePolicyField>;
};

// Step 1 of issuing: a plain GET form to the review page, which shows the premium.
// Nothing is written until Confirm on the review page.
export function IssuePolicyForm({ customers, values, errors = {} }: IssuePolicyFormProps) {
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form method="get" action="/broker/policies/new/review" className="flex flex-col gap-6" noValidate>
      {hasErrors ? <ErrorState title="Check the highlighted fields" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="customerId" label="Customer" error={errors.customerId} className="sm:col-span-2">
          <CustomerSelect name="customerId" customers={customers} defaultValue={values.customerId} />
        </Field>
        <Field id="termStart" label="Term start" hint="12-month term. Cannot be Feb 29." error={errors.termStart}>
          <Input name="termStart" type="date" defaultValue={values.termStart} required />
        </Field>
        <Field
          id="transactionDate"
          label="Transaction date"
          hint="Posting date of the charge. Defaults to today (Toronto)."
          error={errors.transactionDate}
        >
          <Input name="transactionDate" type="date" defaultValue={values.transactionDate} required />
        </Field>
        <Field id="limit" label="Limit (dollars)" hint="$1,000 to $100,000,000." error={errors.limit}>
          <Input name="limit" inputMode="decimal" placeholder="1,000,000" defaultValue={values.limit} required />
        </Field>
        <Field id="rateBps" label="Rate (bps per term)" hint="Whole number, 1 to 10000." error={errors.rateBps}>
          <Input name="rateBps" inputMode="numeric" placeholder="100" defaultValue={values.rateBps} required />
        </Field>
      </div>
      <div>
        <Button type="submit">Review premium</Button>
      </div>
    </form>
  );
}
