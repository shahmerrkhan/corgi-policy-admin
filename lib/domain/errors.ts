// Two failure channels (step 2 default 1):
// - Business rejections the user can trigger return Result { ok: false, code }.
// - Bad input (a caller bug: non-integer cents, invalid date, bad term) throws DomainError.

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type BusinessCode =
  | "POLICY_CANCELLED"
  | "REASON_REQUIRED"
  | "NOT_ENOUGH_REFUNDABLE_CASH"
  | "SAME_EFFECTIVE_DATE"
  | "CHARGE_ALREADY_REVERSED"
  | "INVALID_TERM_START"
  | "CANCEL_DATE_OUTSIDE_TERM"
  | "EFFECTIVE_DATE_OUTSIDE_TERM"
  | "PAYMENT_NOT_SUCCEEDED"
  | "INVALID_COVERAGE_NAME"
  | "DUPLICATE_COVERAGE_NAME"
  | "REASON_TOO_LONG"
  | "TRANSACTION_DATE_TOO_EARLY"
  | "LINE_MISMATCH";

export type Failure = {
  ok: false;
  code: BusinessCode;
  message: string;
  details?: Record<string, string | number>;
};

export type Result<T> = { ok: true; value: T } | Failure;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(
  code: BusinessCode,
  message: string,
  details?: Record<string, string | number>,
): Failure {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}
