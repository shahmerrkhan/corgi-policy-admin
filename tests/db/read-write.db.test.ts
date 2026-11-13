import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/read";
import { brokers, customers } from "@/lib/db/schema";
import { SEED_BROKER, SEED_CUSTOMER } from "@/scripts/seed-data";
import { CLERK_USER_ID_RE } from "@/lib/services/link-users";
import { rolledBack } from "./helpers";

describe("seed (run npm run db:seed first)", () => {
  // Owner decision (step 4, Q6): the seed rows keep their fixed fields; clerk_user_id is
  // null or a linked Clerk user id; the broker may create more customers.
  const linked = (v: unknown) => v === null || (typeof v === "string" && CLERK_USER_ID_RE.test(v));

  it("has exactly 1 broker and at least 1 customer, readable through neon-http", async () => {
    const db = getDb();
    const [b] = await db.select({ n: count() }).from(brokers);
    const [c] = await db.select({ n: count() }).from(customers);
    expect(b?.n).toBe(1);
    expect(c?.n).toBeGreaterThanOrEqual(1);

    const rows = await db.select().from(customers).where(eq(customers.id, SEED_CUSTOMER.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(SEED_CUSTOMER);
    expect(linked(rows[0]?.clerkUserId)).toBe(true);
    const broker = await db.select().from(brokers).where(eq(brokers.id, SEED_BROKER.id));
    expect(broker[0]).toMatchObject(SEED_BROKER);
    expect(linked(broker[0]?.clerkUserId)).toBe(true);
  });
});

describe("withTx", () => {
  it("writes and reads inside one transaction, and a rollback leaves nothing", async () => {
    const id = randomUUID();
    await rolledBack(async (tx) => {
      await tx.insert(brokers).values({ id, name: "Rollback Broker", email: `rb-${id}@test.invalid` });
      const inside = await tx.select().from(brokers).where(eq(brokers.id, id));
      expect(inside).toHaveLength(1);
    });
    const after = await getDb().select().from(brokers).where(eq(brokers.id, id));
    expect(after).toHaveLength(0);
  });
});
