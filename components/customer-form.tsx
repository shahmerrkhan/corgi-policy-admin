"use client";

import { useActionState } from "react";
import { createCustomer, type CustomerFormState } from "@/actions/broker";
import { ErrorState } from "@/components/error-state";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initial: CustomerFormState = {};

export function CustomerForm() {
  const [state, action, pending] = useActionState(createCustomer, initial);
  const e = state.errors ?? {};
  const v = state.values ?? {};

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {state.message ? <ErrorState title="Could not create the customer" description={state.message} /> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Business</legend>
        <Field id="legalName" label="Legal name" error={e.legalName}>
          <Input name="legalName" defaultValue={v.legalName} autoComplete="organization" required />
        </Field>
        <Field id="businessDescription" label="Business description" error={e.businessDescription} className="sm:col-span-2">
          <Textarea name="businessDescription" defaultValue={v.businessDescription} required />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Contact</legend>
        <Field id="contactName" label="Contact name" error={e.contactName}>
          <Input name="contactName" defaultValue={v.contactName} autoComplete="name" required />
        </Field>
        <Field id="email" label="Email" error={e.email}>
          <Input name="email" defaultValue={v.email} type="email" autoComplete="email" required />
        </Field>
        <Field id="phone" label="Phone" error={e.phone}>
          <Input name="phone" defaultValue={v.phone} type="tel" autoComplete="tel" required />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Address</legend>
        <Field id="addressLine1" label="Address line 1" error={e.addressLine1}>
          <Input name="addressLine1" defaultValue={v.addressLine1} autoComplete="address-line1" required />
        </Field>
        <Field id="addressLine2" label="Address line 2" hint="Optional." error={e.addressLine2}>
          <Input name="addressLine2" defaultValue={v.addressLine2} autoComplete="address-line2" />
        </Field>
        <Field id="city" label="City" error={e.city}>
          <Input name="city" defaultValue={v.city} autoComplete="address-level2" required />
        </Field>
        <Field id="region" label="Province or state" error={e.region}>
          <Input name="region" defaultValue={v.region} autoComplete="address-level1" required />
        </Field>
        <Field id="postalCode" label="Postal code" error={e.postalCode}>
          <Input name="postalCode" defaultValue={v.postalCode} autoComplete="postal-code" required />
        </Field>
        <Field id="country" label="Country" hint="Two-letter code." error={e.country}>
          <Input name="country" defaultValue={v.country ?? "CA"} autoComplete="country" maxLength={2} required />
        </Field>
      </fieldset>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
