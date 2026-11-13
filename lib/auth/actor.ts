// The only server file that reads the Clerk session. An actor needs both the role claim
// (publicMetadata.role via the session token) and a database link (clerk_user_id).
import { auth } from "@clerk/nextjs/server";
import { findBrokerByClerkId, findCustomerByClerkId } from "@/lib/services/read-models";
import { roleFromClaims, type Role } from "./roles";

export type AuthErrorCode = "SIGNED_OUT" | "WRONG_ROLE" | "NOT_LINKED";

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(`Not allowed (${code})`);
    this.name = "AuthError";
  }
}

export type BrokerActor = { role: "broker"; clerkUserId: string; brokerId: string };
export type PolicyholderActor = { role: "policyholder"; clerkUserId: string; customerId: string };

async function session(): Promise<{ userId: string; role: Role | null }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) throw new AuthError("SIGNED_OUT");
  return { userId, role: roleFromClaims(sessionClaims) };
}

/** Throws AuthError unless the session is a broker linked to a brokers row. */
export async function requireBroker(): Promise<BrokerActor> {
  const { userId, role } = await session();
  if (role !== "broker") throw new AuthError("WRONG_ROLE");
  const broker = await findBrokerByClerkId(userId);
  if (!broker) throw new AuthError("NOT_LINKED");
  return { role: "broker", clerkUserId: userId, brokerId: broker.id };
}

/** Throws AuthError unless the session is a policyholder linked to a customers row. */
export async function requirePolicyholder(): Promise<PolicyholderActor> {
  const { userId, role } = await session();
  if (role !== "policyholder") throw new AuthError("WRONG_ROLE");
  const customer = await findCustomerByClerkId(userId);
  if (!customer) throw new AuthError("NOT_LINKED");
  return { role: "policyholder", clerkUserId: userId, customerId: customer.id };
}

/** Role claim of the current session, or null when signed out. No database access. */
export async function sessionRole(): Promise<{ signedIn: boolean; role: Role | null }> {
  const { userId, sessionClaims } = await auth();
  return { signedIn: Boolean(userId), role: userId ? roleFromClaims(sessionClaims) : null };
}
