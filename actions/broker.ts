"use server";
// Broker server actions. Each one calls requireBroker() first, before reading input or
// opening a transaction; a policyholder, signed-out or unlinked session is rejected.
import { redirect } from "next/navigation";
import { requireBroker } from "@/lib/auth/actor";
import { withTx } from "@/lib/db/with-tx";
import { createCustomerCommand } from "@/lib/services/customers";
import {
  parseCustomerInput,
  parseIssuePolicyInput,
  type CustomerField,
  type FieldErrors,
  type IssuePolicyField,
} from "@/lib/services/inputs";
import { issuePolicyCommand } from "@/lib/services/issue-policy";

export type FormState<K extends string> = {
  errors?: FieldErrors<K>;
  message?: string;
  /** The submitted text, echoed back so the form keeps it after an error. */
  values?: Record<string, string>;
};

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export type CustomerFormState = FormState<CustomerField>;
export type IssuePolicyFormState = FormState<IssuePolicyField>;

export async function createCustomer(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const broker = await requireBroker();
  const parsed = parseCustomerInput(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors, values: echo(formData) };

  const result = await withTx((tx) => createCustomerCommand(tx, broker, parsed.value));
  if (!result.ok) return { errors: { email: result.message }, values: echo(formData) };

  redirect(`/broker/policies/new?customerId=${result.value.customerId}`);
}

export async function issuePolicy(_prev: IssuePolicyFormState, formData: FormData): Promise<IssuePolicyFormState> {
  const broker = await requireBroker();
  const parsed = parseIssuePolicyInput(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: "Check the highlighted fields." };

  const result = await withTx((tx) => issuePolicyCommand(tx, broker, parsed.value));
  if (!result.ok) return { message: result.message };

  redirect(`/broker/policies/${result.value.policyId}`);
}
