"use server";
// Policyholder server actions. requirePolicyholder() runs first, before reading input or
// calling Stripe; a broker, signed-out or unlinked session is rejected.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePolicyholder } from "@/lib/auth/actor";
import { createCheckoutForPolicyholder } from "@/lib/services/checkout";
import { getStatementForCustomer } from "@/lib/services/statement";
import { getStripe } from "@/lib/stripe/client";

export type PayBalanceState = { message?: string };

/** Origin of this request, for Stripe's return URLs (decision: no APP_BASE_URL until deploy). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startCheckout(_prev: PayBalanceState, formData: FormData): Promise<PayBalanceState> {
  const actor = await requirePolicyholder();
  const policyId = String(formData.get("policyId") ?? "");
  let url: string;
  try {
    const result = await createCheckoutForPolicyholder(actor, policyId, await requestOrigin(), {
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
