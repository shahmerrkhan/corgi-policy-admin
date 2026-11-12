// Guards the "pure domain" rule: no framework/DB/vendor imports, no clock, no float money.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "lib", "domain");
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

function code(f: string): string {
  // Strip comments so prose does not trip the checks.
  return readFileSync(join(DIR, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("lib/domain purity", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s imports nothing outside lib/domain", (f) => {
    const imports = [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const i of imports) expect(i).toMatch(/^\.\//);
  });

  it.each(files)("%s never reads the clock", (f) => {
    expect(code(f)).not.toMatch(/Date\.now\s*\(|new\s+Date\s*\(\s*\)/);
    expect(code(f)).not.toMatch(/new\s+Date\s*\(/);
  });

  it.each(files)("%s has no float math helpers", (f) => {
    expect(code(f)).not.toMatch(/Math\.|toFixed|parseFloat|\d\.\d/);
  });

  it.each(files.filter((f) => f !== "int.ts"))("%s uses intDiv instead of the / operator", (f) => {
    const noRegex = code(f).replace(/\/\^[^\n]*?\$\//g, "");
    expect(noRegex).not.toMatch(/[\w)\]]\s*\/\s*[\w(]/);
  });
});
