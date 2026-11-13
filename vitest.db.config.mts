// Integration tests against the real Neon database (npm run db:check). Not part of
// `npm run test` / `npm run check`. Every test rolls back; nothing is committed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // server-only throws outside a React Server Components bundle; tests import server modules directly.
      "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    name: "db",
    environment: "node",
    include: ["tests/db/**/*.db.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
