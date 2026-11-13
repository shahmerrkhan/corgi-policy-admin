// deliverOnce and the Resend sender with fetch and the email_log store mocked: no network,
// no database. Global fetch is replaced with one that fails the test if anything calls it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowedRecipients,
  deliverOnce,
  type DeliverDeps,
  type Delivery,
  type EmailLogInsert,
} from "@/lib/email/notify";
import { EMAIL_FROM, RESEND_ENDPOINT, sendViaResend } from "@/lib/email/resend";

const API_KEY = "re_test_unit_key_not_real";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const POLICY = "00000000-0000-4000-8000-0000000000a1";

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  kind: "PAYMENT_RECEIVED",
  eventId: EVENT,
  policyId: POLICY,
  recipient: "delivered@resend.dev",
  message: { subject: "Payment received: Policy CGL-000050", text: "We received your payment." },
  ...over,
});

function memoryStore() {
  const rows: EmailLogInsert[] = [];
  return {
    rows,
    store: {
      alreadyLogged: vi.fn(async (kind: string, eventId: string) => rows.some((r) => r.kind === kind && r.eventId === eventId)),
      insert: vi.fn(async (row: EmailLogInsert) => {
        if (!rows.some((r) => r.kind === row.kind && r.eventId === row.eventId)) rows.push(row);
      }),
    },
  };
}

const okResponse = (id = "email_123") => new Response(JSON.stringify({ id }), { status: 200 });

function setup(env: DeliverDeps["env"] = { RESEND_API_KEY: API_KEY }) {
  const mem = memoryStore();
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => okResponse());
  const log = vi.fn<(line: string) => void>();
  const deps: DeliverDeps = { env, fetch: fetchMock, store: mem.store, log };
  return { ...mem, fetchMock, log, deps };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("unexpected network call in a unit test");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deliverOnce", () => {
  it("sends to an allowed recipient and logs sent with the Resend id", async () => {
    const t = setup();
    expect(await deliverOnce(delivery(), t.deps)).toBe("sent");
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchMock.mock.calls[0]!;
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["Idempotency-Key"]).toBe(`PAYMENT_RECEIVED/${EVENT}`);
    expect(JSON.parse(String(init.body))).toEqual({
      from: EMAIL_FROM,
      to: ["delivered@resend.dev"],
      subject: "Payment received: Policy CGL-000050",
      text: "We received your payment.",
    });
    expect(t.rows).toEqual([
      { kind: "PAYMENT_RECEIVED", eventId: EVENT, policyId: POLICY, recipient: "delivered@resend.dev", status: "sent", providerId: "email_123", error: null },
    ]);
  });

  it("skips a recipient not in RESEND_ALLOWED_TO without calling Resend", async () => {
    const t = setup({ RESEND_API_KEY: API_KEY, RESEND_ALLOWED_TO: "owner@example.com, delivered@resend.dev" });
    expect(await deliverOnce(delivery({ recipient: "someone@else.test" }), t.deps)).toBe("skipped");
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.rows[0]).toMatchObject({ status: "skipped", providerId: null, error: "recipient not in RESEND_ALLOWED_TO" });
  });

  it("skips when RESEND_API_KEY is missing or blank", async () => {
    for (const env of [{}, { RESEND_API_KEY: "  " }]) {
      const t = setup(env);
      expect(await deliverOnce(delivery(), t.deps)).toBe("skipped");
      expect(t.fetchMock).not.toHaveBeenCalled();
      expect(t.rows[0]).toMatchObject({ status: "skipped", error: "RESEND_API_KEY not set" });
    }
  });

  it("logs failed (and does not throw) on an API error response", async () => {
    const t = setup();
    t.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "validation_error", message: `bad key ${API_KEY}` }), { status: 422 }),
    );
    expect(await deliverOnce(delivery(), t.deps)).toBe("failed");
    expect(t.rows[0]).toMatchObject({ status: "failed", providerId: null, error: "HTTP 422 (validation_error)" });
    expect(t.log.mock.calls.flat().join("\n")).not.toContain(API_KEY);
  });

  it("logs failed (and does not throw) on a network error or timeout", async () => {
    const t = setup();
    t.fetchMock.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    expect(await deliverOnce(delivery(), t.deps)).toBe("failed");
    expect(t.rows[0]).toMatchObject({ status: "failed", error: "request failed (TimeoutError)" });
  });

  it("sends once for a duplicate event", async () => {
    const t = setup();
    expect(await deliverOnce(delivery(), t.deps)).toBe("sent");
    expect(await deliverOnce(delivery(), t.deps)).toBe("duplicate");
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    expect(t.rows).toHaveLength(1);
    // The same event id under the other kind is a different email.
    expect(await deliverOnce(delivery({ kind: "COVERAGE_DATE_CORRECTED" }), t.deps)).toBe("sent");
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when the email_log store fails", async () => {
    const t = setup();
    t.store.insert.mockRejectedValueOnce(Object.assign(new Error("db down"), { name: "NeonDbError" }));
    expect(await deliverOnce(delivery(), t.deps)).toBe("error");
    t.store.alreadyLogged.mockRejectedValueOnce(new Error("db down"));
    expect(await deliverOnce(delivery(), t.deps)).toBe("error");
  });

  it("never logs the key, the recipient or the body", async () => {
    const t = setup();
    await deliverOnce(delivery(), t.deps);
    const logged = t.log.mock.calls.flat().join("\n");
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain("delivered@resend.dev");
    expect(logged).not.toContain("We received your payment");
    expect(logged).toContain(EVENT);
  });
});

describe("allowedRecipients", () => {
  it("defaults to delivered@resend.dev and ignores case and spaces", () => {
    expect([...allowedRecipients(undefined)]).toEqual(["delivered@resend.dev"]);
    expect([...allowedRecipients(" ")]).toEqual(["delivered@resend.dev"]);
    expect([...allowedRecipients(" Owner@Example.com ,delivered@resend.dev,")]).toEqual(["owner@example.com", "delivered@resend.dev"]);
  });
});

describe("sendViaResend", () => {
  it("treats a 200 without an id as a failure", async () => {
    const f = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await sendViaResend(API_KEY, { to: "a@b.test", subject: "s", text: "t", idempotencyKey: "k" }, f)).toEqual({
      ok: false,
      error: "HTTP 200 (no error name)",
    });
  });
});
