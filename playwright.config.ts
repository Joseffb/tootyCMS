import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

if (!process.env.POSTGRES_URL && process.env.POSTGRES_TEST_URL) {
  process.env.POSTGRES_URL = process.env.POSTGRES_TEST_URL;
}

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
