import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CLAUDE.md is the single rules file; stop `next dev` from (re)writing AGENTS.md.
  agentRules: false,
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
