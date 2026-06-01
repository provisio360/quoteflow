import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests cover the pure decision cores under src/domains — no DB, no network.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
