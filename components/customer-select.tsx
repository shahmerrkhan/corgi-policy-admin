"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CustomerSelectProps = {
  name: string;
  customers: { id: string; legalName: string }[];
  defaultValue?: string;
  // Set by Field on its child; forwarded to the trigger so the label and errors attach to it.
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function CustomerSelect({ name, customers, defaultValue, ...control }: CustomerSelectProps) {
  return (
    <Select name={name} defaultValue={defaultValue || undefined}>
      <SelectTrigger className="w-full" {...control}>
        <SelectValue placeholder="Choose a customer" />
      </SelectTrigger>
      <SelectContent position="popper">
        {customers.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.legalName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
