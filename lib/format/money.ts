// Display-only money formatting. Input is always integer cents; no floats are
// ever produced from it (dollars and cents are split with integer arithmetic).

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Expected integer cents, got ${cents}`);
  }
}

/** 123456 -> "1,234.56" (absolute value, no sign, no currency symbol). */
function formatAbs(cents: number): string {
  const abs = Math.abs(cents);
  const rem = abs % 100;
  const dollars = (abs - rem) / 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${String(rem).padStart(2, "0")}`;
}

/** 123456 -> "$1,234.56"; -1234 -> "-$1,234.00". */
export function formatCents(cents: number): string {
  assertCents(cents);
  return `${cents < 0 ? "-" : ""}$${formatAbs(cents)}`;
}

/** Balance owed: 1400 -> "$14.00"; 0 -> "$0.00"; credit -61200 -> "(612.00) CR". */
export function formatBalance(cents: number): string {
  assertCents(cents);
  return cents < 0 ? `(${formatAbs(cents)}) CR` : `$${formatAbs(cents)}`;
}
