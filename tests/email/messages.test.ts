import { describe, expect, it } from "vitest";
import { coverageCorrectedMessage, paymentReceivedMessage } from "@/lib/email/messages";

describe("email messages", () => {
  it("payment received", () => {
    expect(
      paymentReceivedMessage({ policyNumber: "CGL-000050", amountCents: 50_000, paymentDate: "2026-11-13", balanceCents: 23_000 }),
    ).toEqual({
      subject: "Payment received: Policy CGL-000050",
      text: "We received your payment of $500.00 on 2026-11-13 for policy CGL-000050.\nBalance due: $230.00",
    });
  });

  it("payment received leaving a credit", () => {
    const m = paymentReceivedMessage({ policyNumber: "CGL-000050", amountCents: 80_000, paymentDate: "2026-11-13", balanceCents: -7_000 });
    expect(m.text.split("\n")[1]).toBe("Credit: $70.00");
  });

  it("coverage date corrected", () => {
    expect(
      coverageCorrectedMessage({
        policyNumber: "CGL-000050",
        coverageName: "Products-completed operations",
        oldEffectiveDate: "2026-02-01",
        newEffectiveDate: "2026-03-01",
        oldAmountCents: 100_000,
        newAmountCents: 91_781,
        netChangeCents: -8_219,
        balanceCents: 14_781,
      }),
    ).toEqual({
      subject: "Coverage date corrected: Policy CGL-000050",
      text: [
        "The effective date of Products-completed operations on policy CGL-000050 was corrected.",
        "Effective date: 2026-02-01 -> 2026-03-01",
        "Premium charge: $1,000.00 -> $917.81",
        "Net change: -$82.19",
        "Balance due: $147.81",
      ].join("\n"),
    });
  });
});
