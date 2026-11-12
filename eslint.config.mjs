import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const POOL_MESSAGE = "Only lib/db/with-tx.ts may create a Pool.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@neondatabase/serverless",
              importNames: ["Pool", "Client"],
              message: POOL_MESSAGE,
            },
            {
              name: "drizzle-orm/neon-serverless",
              message: POOL_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/db/with-tx.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
