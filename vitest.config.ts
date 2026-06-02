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
    // Unit tests cover the pure decision cores under src/domains — no DB, no network.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
