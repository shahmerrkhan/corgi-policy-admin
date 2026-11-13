// Resend REST API over fetch (no SDK). Plain text only. Never throws: returns the Resend
// message id or a short error. Errors never contain the API key, the body or the recipient.

export const EMAIL_FROM = "Policy Admin <onboarding@resend.dev>";
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const SEND_TIMEOUT_MS = 5_000;

export type OutgoingEmail = { to: string; subject: string; text: string; idempotencyKey: string };
export type SendResult = { ok: true; id: string } | { ok: false; error: string };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function sendViaResend(apiKey: string, email: OutgoingEmail, fetchImpl: FetchLike = fetch): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `request failed (${err instanceof Error ? err.name : "unknown"})` };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body: fall through with null.
  }
  const fields = (body && typeof body === "object" ? body : {}) as { id?: unknown; name?: unknown };
  if (res.ok && typeof fields.id === "string" && fields.id) return { ok: true, id: fields.id };
  // Resend error bodies carry a machine-readable `name` (e.g. validation_error); keep only that.
  const name = typeof fields.name === "string" ? fields.name.slice(0, 80) : "no error name";
  return { ok: false, error: `HTTP ${res.status} (${name})` };
}
