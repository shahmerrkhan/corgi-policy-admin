// Service results. Business rejections are values; bugs throw.
export type ServiceFailure = { ok: false; code: string; message: string };
export type ServiceResult<T> = { ok: true; value: T } | ServiceFailure;

/** Postgres error code (e.g. 23505) anywhere in a driver error's cause chain. */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
