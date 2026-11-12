import { describe, expect, it } from "vitest";
import { formatBalance, formatCents } from "@/lib/format/money";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [99, "$0.99"],
    [100, "$1.00"],
    [123456, "$1,234.56"],
    [100000000, "$1,000,000.00"],
    [-1234, "-$12.34"],
    [-123400, "-$1,234.00"],
  ])("formats %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it.each([1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    "throws on non-integer input %s",
    (cents) => {
      expect(() => formatCents(cents)).toThrow(TypeError);
    },
  );
});

describe("formatBalance", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [1400, "$14.00"],
    [123456, "$1,234.56"],
    [100000000, "$1,000,000.00"],
    [-1, "(0.01) CR"],
    [-99, "(0.99) CR"],
    [-61200, "(612.00) CR"],
    [-123456, "(1,234.56) CR"],
    [-100000000, "(1,000,000.00) CR"],
  ])("formats %i as %s", (cents, expected) => {
    expect(formatBalance(cents)).toBe(expected);
  });

  it.each([1.5, -0.5, Number.NaN])("throws on non-integer input %s", (cents) => {
    expect(() => formatBalance(cents)).toThrow(TypeError);
  });
});
