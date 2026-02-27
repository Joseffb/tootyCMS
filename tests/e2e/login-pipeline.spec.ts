import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-login-pipeline-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";

const userId = `${runId}-user`;
const email = `${runId}@example.com`;
const password = "password123";

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for login pipeline e2e.",
);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await setSettingByKey("setup_completed", "true");
  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, ${"Login Pipeline Test User"}, 'administrator', 'native', ${passwordHash}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = NOW()
  `;
});

test.afterAll(async () => {
  await sql`DELETE FROM tooty_users WHERE "id" = ${userId}`;
});

test("native login persists a valid session and grants /app access", async ({ page }) => {
  await page.goto(`${appOrigin}/login`);

  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login with Email" }).click();

  await page.waitForURL(/\/app(\/.*)?$/i, { timeout: 20000 });
  await expect(page).not.toHaveURL(/\/login(\?|$)/i);

  const sessionResponse = await page.request.get(`${appOrigin}/api/auth/session`);
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionJson = await sessionResponse.json();
  expect(String(sessionJson?.user?.email || "").toLowerCase()).toBe(email);

  const appResponse = await page.goto(`${appOrigin}/app`);
  expect(appResponse?.ok()).toBeTruthy();
  await expect(page).not.toHaveURL(/\/login(\?|$)/i);
});

