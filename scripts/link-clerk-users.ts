// Links the two hand-made Clerk demo users to the seeded broker and customer.
// Run: npm run db:link -- --broker user_... --policyholder user_...
// Checks each user's publicMetadata.role through the Clerk Backend API (read-only), then
// writes clerk_user_id in one transaction. Prints outcomes only: never keys, user ids or
// the connection string.
import { parseArgs } from "node:util";
import { withTx } from "@/lib/db/with-tx";
import { LinkError, linkClerkUsers, validateClerkIds } from "@/lib/services/link-users";
import { SEED_BROKER, SEED_CUSTOMER } from "./seed-data";

async function clerkRole(userId: string, label: string): Promise<unknown> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new LinkError("CLERK_SECRET_KEY is not set (add it to .env.local)");
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) throw new LinkError(`${label}: no such Clerk user`);
  if (!res.ok) throw new LinkError(`${label}: Clerk API returned ${res.status}`);
  const user = (await res.json()) as { public_metadata?: { role?: unknown } };
  return user.public_metadata?.role;
}

async function main() {
  const { values } = parseArgs({
    options: { broker: { type: "string" }, policyholder: { type: "string" } },
    strict: true,
  });
  const brokerClerkId = values.broker ?? "";
  const policyholderClerkId = values.policyholder ?? "";
  validateClerkIds(brokerClerkId, policyholderClerkId);

  if ((await clerkRole(brokerClerkId, "broker")) !== "broker") {
    throw new LinkError('broker: publicMetadata.role is not "broker" in Clerk');
  }
  if ((await clerkRole(policyholderClerkId, "policyholder")) !== "policyholder") {
    throw new LinkError('policyholder: publicMetadata.role is not "policyholder" in Clerk');
  }

  const result = await withTx((tx) =>
    linkClerkUsers(tx, {
      brokerRowId: SEED_BROKER.id,
      customerRowId: SEED_CUSTOMER.id,
      brokerClerkId,
      policyholderClerkId,
    }),
  );
  console.log(`link: broker ${result.broker}; policyholder ${result.policyholder}`);
}

main().catch((err: unknown) => {
  const e = err as { name?: string; message?: string; code?: string };
  // LinkError messages never contain ids; for anything else print only the class and code.
  console.error(e.name === "LinkError" ? `link failed: ${e.message}` : `link failed: ${e.name ?? "Error"} ${e.code ?? ""}`);
  process.exit(1);
});
