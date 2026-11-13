// Pure role and route rules. No Clerk import, so proxy.ts, pages and tests share one definition.

export type Role = "broker" | "policyholder";

/** Reads publicMetadata.role from the session claims (null for anything else). */
export function roleFromClaims(claims: unknown): Role | null {
  if (!claims || typeof claims !== "object") return null;
  const metadata = (claims as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const role = (metadata as { role?: unknown }).role;
  return role === "broker" || role === "policyholder" ? role : null;
}

export type RouteDecision = "allow" | "sign-in" | "no-access";

const PUBLIC_PREFIXES = ["/sign-in", "/no-access", "/api/webhooks/stripe"];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Optimistic routing check used by proxy.ts. Pages and server actions check the role
 * again (with the database link) on the server; this is never the only check.
 */
export function routeDecision(pathname: string, session: { signedIn: boolean; role: Role | null }): RouteDecision {
  if (PUBLIC_PREFIXES.some((p) => under(pathname, p))) return "allow";
  if (!session.signedIn) return "sign-in";
  if (under(pathname, "/broker")) return session.role === "broker" ? "allow" : "no-access";
  if (under(pathname, "/portal")) return session.role === "policyholder" ? "allow" : "no-access";
  return "allow";
}

/** Where a signed-in user lands from "/". */
export function homeFor(role: Role | null): string {
  if (role === "broker") return "/broker";
  if (role === "policyholder") return "/portal";
  return "/no-access";
}
