import { DomainError } from "./errors";

/**
 * Exact floor division of safe integers. This is the only place in lib/domain that
 * uses the "/" operator: the remainder is removed first, so the division is exact and
 * no fractional value ever exists.
 */
export function intDiv(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b <= 0) {
    throw new DomainError(`intDiv needs safe integers and a positive divisor, got ${a} / ${b}`);
  }
  let r = a % b;
  if (r < 0) r += b;
  return (a - r) / b;
}

export function minInt(a: number, b: number): number {
  return a < b ? a : b;
}

export function maxInt(a: number, b: number): number {
  return a > b ? a : b;
}
