import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "TRACE_PROFILE=Test npm run dev -- --port 3000",
    // Root path can return 404 depending on host routing; static icon is always available.
    url: "http://localhost:3000/icon.svg",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
