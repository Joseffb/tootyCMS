import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
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

// Force isolated, domain-neutral test defaults so local branded installs do not leak into E2E.
process.env.CMS_DB_PREFIX = process.env.CMS_DB_PREFIX_TEST_OVERRIDE || "tooty_";
process.env.ADMIN_PATH = process.env.ADMIN_PATH_TEST_OVERRIDE || "cp";
if (process.env.POSTGRES_TEST_URL) {
  process.env.POSTGRES_URL = process.env.POSTGRES_TEST_URL;
}

const explicitTestPort = Number.parseInt(process.env.TEST_PORT || "", 10);
const preferredPort = explicitTestPort || Number.parseInt(process.env.PLAYWRIGHT_DEFAULT_TEST_PORT || "3000", 10) || 3000;
const resolvedPort = explicitTestPort || Number.parseInt(
  execFileSync(process.execPath, [path.join(process.cwd(), "scripts/resolve-test-port.mjs"), String(preferredPort)], {
    encoding: "utf8",
  }).trim(),
  10,
) || preferredPort;
const testPort = String(resolvedPort);
const browserOrigin = `http://localhost:${testPort}`;
const healthcheckOrigin = `http://127.0.0.1:${testPort}`;
const testDistDir = `.next-test-${testPort}`;
const edgeExecutablePath =
  process.env.PLAYWRIGHT_EDGE_EXECUTABLE_PATH ||
  (fs.existsSync("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
    ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    : "");
const edgeProjects = edgeExecutablePath
  ? [
      {
        name: "edge",
        use: {
          browserName: "chromium" as const,
          launchOptions: {
            executablePath: edgeExecutablePath,
          },
        },
      },
    ]
  : [];
const projectCount = 3 + edgeProjects.length;

process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL_TEST_OVERRIDE || browserOrigin;
process.env.NEXT_PUBLIC_ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN_TEST_OVERRIDE || `localhost:${testPort}`;
process.env.E2E_APP_ORIGIN = process.env.E2E_APP_ORIGIN || process.env.NEXTAUTH_URL;
process.env.E2E_PUBLIC_ORIGIN = process.env.E2E_PUBLIC_ORIGIN || `http://localhost:${testPort}`;
process.env.TEST_PORT = testPort;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: projectCount,
  retries: 0,
  use: {
    baseURL: browserOrigin,
    trace: "on-first-retry",
  },
  webServer: {
    command: `NEXT_DIST_DIR=${testDistDir} TRACE_PROFILE=Test npm run dev -- --port ${testPort}`,
    // Root path can return 404 depending on host routing; static icon is always available.
    url: `${healthcheckOrigin}/icon.svg`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 5_000,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
      },
    },
    {
      name: "webkit",
      use: {
        browserName: "webkit",
      },
    },
    ...edgeProjects,
  ],
});
