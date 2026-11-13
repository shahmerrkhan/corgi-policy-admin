// Plain-text email bodies (step 11). Pure; money is integer cents formatted for display.
import { formatCents } from "@/lib/format/money";

export type Message = { subject: string; text: string };

/** "Balance due: $230.00", or "Credit: $12.00" when the customer is in credit. */
function balanceLine(balanceCents: number): string {
  return balanceCents < 0 ? `Credit: ${formatCents(-balanceCents)}` : `Balance due: ${formatCents(balanceCents)}`;
}

export function paymentReceivedMessage(input: {
  policyNumber: string;
  amountCents: number;
  paymentDate: string;
  balanceCents: number;
}): Message {
  return {
    subject: `Payment received: Policy ${input.policyNumber}`,
    text: [
      `We received your payment of ${formatCents(input.amountCents)} on ${input.paymentDate} for policy ${input.policyNumber}.`,
      balanceLine(input.balanceCents),
    ].join("\n"),
  };
}

export function coverageCorrectedMessage(input: {
  policyNumber: string;
  coverageName: string;
  oldEffectiveDate: string;
  newEffectiveDate: string;
  oldAmountCents: number;
  newAmountCents: number;
  netChangeCents: number;
  balanceCents: number;
}): Message {
  return {
    subject: `Coverage date corrected: Policy ${input.policyNumber}`,
    text: [
      `The effective date of ${input.coverageName} on policy ${input.policyNumber} was corrected.`,
      `Effective date: ${input.oldEffectiveDate} -> ${input.newEffectiveDate}`,
      `Premium charge: ${formatCents(input.oldAmountCents)} -> ${formatCents(input.newAmountCents)}`,
      `Net change: ${formatCents(input.netChangeCents)}`,
      balanceLine(input.balanceCents),
    ].join("\n"),
  };
}
