import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    testTimeout: 45_000,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "plugins/**/tests/**/*.test.ts",
      "plugins/**/tests/**/*.test.tsx",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", "coverage/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/api/uploadImage/route.ts", "lib/uploadSmart.tsx", "proxy.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
