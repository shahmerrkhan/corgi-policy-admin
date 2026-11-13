import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CLAUDE.md is the single rules file; stop `next dev` from (re)writing AGENTS.md.
  agentRules: false,
  env: {
    // Never let Clerk auto-provision temporary "keyless" dev keys: real keys come from .env.local.
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
