"use server";
// Policyholder server actions. requirePolicyholder() runs first, before reading input or
// calling Stripe; a broker, signed-out or unlinked session is rejected.
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { requirePolicyholder } from "@/lib/auth/actor";
import { createCheckoutForPolicyholder } from "@/lib/services/checkout";
import { getStatementForCustomer } from "@/lib/services/statement";
import { getStripe } from "@/lib/stripe/client";

export type PayBalanceState = { message?: string };

export async function startCheckout(_prev: PayBalanceState, formData: FormData): Promise<PayBalanceState> {
  const actor = await requirePolicyholder();
  const policyId = String(formData.get("policyId") ?? "");
  let url: string;
  try {
    const result = await createCheckoutForPolicyholder(actor, policyId, appUrl(), {
      loadStatement: getStatementForCustomer,
      createSession: (params) => getStripe().checkout.sessions.create(params),
    });
    if (!result.ok) return { message: result.message };
    url = result.value.url;
  } catch (err) {
    console.error(`checkout session creation failed (${err instanceof Error ? err.name : "unknown"})`);
    return { message: "Could not start the payment. Try again in a moment." };
  }
  // Outside the try: redirect() throws to navigate.
  redirect(url);
}
