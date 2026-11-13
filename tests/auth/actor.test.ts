import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROKER_ROW_ID, CUSTOMER_ROW_ID, clerkMock, readModelsMock, sessions, state } from "../actions/session-mocks";

vi.mock("@clerk/nextjs/server", () => clerkMock());
vi.mock("@/lib/services/read-models", () => readModelsMock());

const { AuthError, requireBroker, requirePolicyholder } = await import("@/lib/auth/actor");

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    return (e as InstanceType<typeof AuthError>).code;
  }
}

describe("requireBroker", () => {
  beforeEach(() => {
    state.session = sessions.signedOut!;
  });

  it("returns the linked broker", async () => {
    state.session = sessions.linkedBroker!;
    await expect(requireBroker()).resolves.toEqual({ role: "broker", clerkUserId: "user_broker", brokerId: BROKER_ROW_ID });
  });

  it("rejects signed out, wrong role, no role and an unlinked broker", async () => {
    state.session = sessions.signedOut!;
    expect(await code(requireBroker())).toBe("SIGNED_OUT");
    state.session = sessions.linkedPolicyholder!;
    expect(await code(requireBroker())).toBe("WRONG_ROLE");
    state.session = sessions.noRole!;
    expect(await code(requireBroker())).toBe("WRONG_ROLE");
    state.session = sessions.unlinkedBroker!;
    expect(await code(requireBroker())).toBe("NOT_LINKED");
  });
});

describe("requirePolicyholder", () => {
  it("returns the linked customer and rejects a broker", async () => {
    state.session = sessions.linkedPolicyholder!;
    await expect(requirePolicyholder()).resolves.toEqual({
      role: "policyholder",
      clerkUserId: "user_holder",
      customerId: CUSTOMER_ROW_ID,
    });
    state.session = sessions.linkedBroker!;
    expect(await code(requirePolicyholder())).toBe("WRONG_ROLE");
  });

  it("rejects a policyholder role with no customer link", async () => {
    state.session = { userId: "user_other", sessionClaims: { metadata: { role: "policyholder" } } };
    expect(await code(requirePolicyholder())).toBe("NOT_LINKED");
  });
});
