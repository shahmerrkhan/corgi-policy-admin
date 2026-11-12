// Seeds one broker and one policyholder customer. Safe to run any number of times.
// Run: npm run db:seed (loads .env.local). Prints row counts only, never the connection string.
import { count } from "drizzle-orm";
import { brokers, customers } from "@/lib/db/schema";
import { withTx } from "@/lib/db/with-tx";
import { SEED_BROKER, SEED_CUSTOMER } from "./seed-data";

async function main() {
  const result = await withTx(async (tx) => {
    const b = await tx.insert(brokers).values(SEED_BROKER).onConflictDoNothing({ target: brokers.id }).returning();
    const c = await tx.insert(customers).values(SEED_CUSTOMER).onConflictDoNothing({ target: customers.id }).returning();
    const [brokerCount] = await tx.select({ n: count() }).from(brokers);
    const [customerCount] = await tx.select({ n: count() }).from(customers);
    return {
      insertedBrokers: b.length,
      insertedCustomers: c.length,
      brokers: brokerCount?.n ?? 0,
      customers: customerCount?.n ?? 0,
    };
  });
  console.log(
    `seed: inserted ${result.insertedBrokers} broker(s), ${result.insertedCustomers} customer(s); ` +
      `table totals: brokers=${result.brokers}, customers=${result.customers}`,
  );
}

main().catch((err: unknown) => {
  const e = err as { message?: string; code?: string };
  console.error(`seed failed: ${e.code ?? ""} ${e.message ?? String(err)}`);
  process.exit(1);
});
