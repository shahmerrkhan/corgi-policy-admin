// notifyPaymentReceived / notifyCoverageCorrected never throw, even when the database read
// fails or the event is missing. The database is mocked; fetch must never be called.
import { describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => {
  throw Object.assign(new Error("connection refused"), { name: "NeonDbError" });
});
vi.mock("@/lib/db/read", () => ({ getDb }));

const { notifyCoverageCorrected, notifyPaymentReceived } = await import("@/lib/email/notify");

const deps = () => ({
  env: { RESEND_API_KEY: "re_test_unit_key_not_real" },
  fetch: vi.fn(async () => new Response("{}")),
  store: { alreadyLogged: vi.fn(async () => false), insert: vi.fn(async () => {}) },
  log: vi.fn(),
});

describe("notify* never throw", () => {
  it("returns error and sends nothing when loading the event fails", async () => {
    for (const fn of [notifyPaymentReceived, notifyCoverageCorrected]) {
      const d = deps();
      await expect(fn("00000000-0000-4000-8000-0000000000e1", d)).resolves.toBe("error");
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.store.insert).not.toHaveBeenCalled();
      expect(d.log.mock.calls.flat().join("\n")).toMatch(/error \(NeonDbError\)/);
    }
  });
});
