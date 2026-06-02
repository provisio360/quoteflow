import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests exercise the real spec → Prisma `where` translation against
// a live Postgres (ADR-0008 / grilling Q8: a fake store would tautologically
// pass without proving the SQL actually filters). Run with `npm run test:integration`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    // Load DATABASE_URL/DIRECT_URL from .env (same as the project's scripts).
    setupFiles: ["./vitest.integration.setup.ts"],
    // DB tests share one schema; run serially to avoid cross-test interference.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
