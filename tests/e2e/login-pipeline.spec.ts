import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteDomainTypeTables } from "../../lib/site-domain-type-tables";
import { getAppHostname, getAppOrigin } from "./helpers/env";
import { buildProjectRunId } from "./helpers/project-scope";
import { addSessionTokenCookie } from "./helpers/auth";
import { ensureCoreSiteDomain, ensureNetworkSite, ensureNetworkUser } from "./helpers/storage";

const appOrigin = getAppOrigin();
const appHostname = getAppHostname();

let userId = "";
let email = "";
let siteId = "";

async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
      if (code !== "40P01" || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

async function getSessionJsonWithRetry(
  page: import("@playwright/test").Page,
  sessionUrl: string,
  timeoutMs = 30_000,
) {
  const started = Date.now();
  let lastError: unknown = null;
  let lastStatus = 0;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const json = await response.json().catch(() => null);
        return { status: response.status, json };
      }, sessionUrl);
      lastStatus = Number(result?.status || 0);
      if (lastStatus === 200) {
        return result?.json;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (lastError) throw lastError;
  throw new Error(`Session endpoint did not return 200 within ${timeoutMs}ms. Last status: ${lastStatus}`);
}

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for login pipeline e2e.",
);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const runId = buildProjectRunId("e2e-login-pipeline", testInfo.project.name);
  userId = `${runId}-user`;
  siteId = `${runId}-site`;
  email = `${runId}@example.com`;
  await withDeadlockRetry(() => setSettingByKey("setup_completed", "true"));
  await withDeadlockRetry(() =>
    ensureNetworkUser({
      id: userId,
      email,
      name: "Login Pipeline Test User",
      role: "administrator",
    }),
  );
  await withDeadlockRetry(() =>
    ensureNetworkSite({
      id: siteId,
      userId,
      name: "Login Pipeline Site",
      subdomain: `${runId}-site`,
      isPrimary: true,
    }),
  );
  await withDeadlockRetry(() => ensureCoreSiteDomain(siteId, "post"));
  await withDeadlockRetry(() => ensureCoreSiteDomain(siteId, "page"));
  await withDeadlockRetry(() => ensureSiteDomainTypeTables(siteId, "post"));
  await withDeadlockRetry(() => ensureSiteDomainTypeTables(siteId, "page"));
});

test("native login persists a valid session and grants /app access", async ({ page }) => {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for login pipeline e2e.");
  const token = await encode({
    secret,
    token: {
      sub: userId,
      email,
      name: "Login Pipeline Test User",
      role: "administrator",
      user: {
        id: userId,
        email,
        name: "Login Pipeline Test User",
        role: "administrator",
      },
    },
    maxAge: 60 * 60 * 24,
  });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    domain: appHostname,
    expires,
  });

  // Edge can stall waiting for full DOM readiness on the heavy admin shell under load.
  // Commit + URL assertions still prove the auth gate granted access to the app host.
  await page.goto(`${appOrigin}/app/cp`, { waitUntil: "commit" });
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
  await expect
    .poll(async () => page.url(), {
      timeout: 30_000,
      message: "expected authenticated session to resolve to an app route instead of login",
    })
    .not.toMatch(/\/login(?:[/?#]|$)/);

  const sessionJson = await getSessionJsonWithRetry(page, `${appOrigin}/api/auth/session`);
  expect(String(sessionJson?.user?.email || "").toLowerCase()).toBe(email);
});
