// Shared mocks for tests that exercise auth and server actions without Clerk or a database.
import { vi } from "vitest";

export const BROKER_ROW_ID = "00000000-0000-4000-8000-0000000000b1";
export const CUSTOMER_ROW_ID = "00000000-0000-4000-8000-0000000000c1";

type Session = { userId: string | null; sessionClaims: unknown };

export const sessions: Record<string, Session> = {
  signedOut: { userId: null, sessionClaims: null },
  linkedPolicyholder: { userId: "user_holder", sessionClaims: { metadata: { role: "policyholder" } } },
  linkedBroker: { userId: "user_broker", sessionClaims: { metadata: { role: "broker" } } },
  unlinkedBroker: { userId: "user_stranger", sessionClaims: { metadata: { role: "broker" } } },
  noRole: { userId: "user_norole", sessionClaims: { metadata: {} } },
};

/** Database links: only user_broker and user_holder have rows. */
export const links = {
  broker: { user_broker: { id: BROKER_ROW_ID, name: "Test Broker" } } as Record<string, { id: string; name: string }>,
  customer: { user_holder: { id: CUSTOMER_ROW_ID, legalName: "Test Co" } } as Record<string, { id: string; legalName: string }>,
};

export const state = { session: sessions.signedOut as Session };

export const clerkMock = () => ({ auth: vi.fn(async () => state.session) });

export const readModelsMock = () => ({
  findBrokerByClerkId: vi.fn(async (id: string) => links.broker[id] ?? null),
  findCustomerByClerkId: vi.fn(async (id: string) => links.customer[id] ?? null),
});
