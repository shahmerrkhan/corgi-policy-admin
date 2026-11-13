// Create customer command. Runs inside withTx; the broker comes from the session.
import { randomUUID } from "node:crypto";
import { customers } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-tx";
import type { CustomerInput } from "./inputs";
import { pgErrorCode, type ServiceResult } from "./result";

export async function createCustomerCommand(
  tx: Tx,
  broker: { brokerId: string },
  input: CustomerInput,
): Promise<ServiceResult<{ customerId: string }>> {
  const id = randomUUID();
  try {
    // Savepoint, so a unique violation leaves the outer transaction usable.
    await tx.transaction(async (sp) => {
      await sp.insert(customers).values({ id, brokerId: broker.brokerId, clerkUserId: null, ...input });
    });
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      return { ok: false, code: "EMAIL_TAKEN", message: "A customer with this email already exists." };
    }
    throw err;
  }
  return { ok: true, value: { customerId: id } };
}
