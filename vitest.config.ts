import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" -> "./src/*" so domain cores can cross-import.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit tests cover the pure decision cores (and pure adapter helpers) — no
    // DB, no network. Integration tests (*.integration.test.ts) hit real
    // Postgres and run via vitest.integration.config.ts, so exclude them here.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
});
