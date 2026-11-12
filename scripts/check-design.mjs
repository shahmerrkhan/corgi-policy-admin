#!/usr/bin/env node
// Fails (exit 1) if app/ or components/ contain banned design patterns:
// shadows, gradients, backdrop blur, large radii, or emoji.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DIRS = ["app", "components"];
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md", ".mdx"];

// The status badge dot is the only element allowed to be fully round.
const ROUNDED_FULL_ALLOWED = new Set(["components/status-badge.tsx"]);

const COLOR =
  "(?:\\[|transparent\\b|white\\b|black\\b|current\\b|inherit\\b|" +
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b|" +
  "(?:bg|surface|sunken|text|text-muted|border|border-strong|accent|pending|ok|fail|background|foreground|card|popover|primary|secondary|muted|destructive|input|ring)\\b)";

const RULES = [
  { name: "shadow", re: /(?<![\w-])(?:drop-)?shadow-/ },
  { name: "gradient (bg-gradient)", re: /(?<![\w-])bg-gradient-/ },
  { name: "gradient (bg-linear/radial/conic)", re: /(?<![\w-])bg-(?:linear|radial|conic)-/ },
  { name: "gradient stop (from-/via-/to-)", re: new RegExp(`(?<![\\w-])(?:from|via|to)-${COLOR}`) },
  { name: "backdrop-blur", re: /(?<![\w-])backdrop-blur/ },
  {
    name: "large radius",
    re: /(?<![\w-])rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-(?:lg|xl|2xl)(?![\w-])/,
  },
  {
    name: "rounded-full",
    re: /(?<![\w-])rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-full(?![\w-])/,
    allow: ROUNDED_FULL_ALLOWED,
  },
  { name: "emoji", re: /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.some((e) => name.endsWith(e))) yield full;
  }
}

const problems = [];
for (const d of DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.allow?.has(rel)) continue;
        const m = line.match(rule.re);
        if (m) problems.push(`${rel}:${i + 1}  ${rule.name}  "${m[0]}"`);
      }
    });
  }
}

if (problems.length) {
  console.error(`check-design: ${problems.length} problem(s)\n` + problems.join("\n"));
  process.exit(1);
}
console.log("check-design: ok");
