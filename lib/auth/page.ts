// Page-level guards: same checks as the actions, but redirect instead of throwing.
import { redirect } from "next/navigation";
import { AuthError, requireBroker, requirePolicyholder, type BrokerActor, type PolicyholderActor } from "./actor";

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) redirect(err.code === "SIGNED_OUT" ? "/sign-in" : "/no-access");
    throw err;
  }
}

export function brokerPage(): Promise<BrokerActor> {
  return guard(requireBroker);
}

export function policyholderPage(): Promise<PolicyholderActor> {
  return guard(requirePolicyholder);
}
