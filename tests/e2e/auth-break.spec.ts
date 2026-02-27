import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-auth-break-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const runAuthBreakE2E = process.env.RUN_AUTH_BREAK_E2E === "1";

const adminUserId = `${runId}-admin-user`;
const editorUserId = `${runId}-editor-user`;
const adminSiteId = `${runId}-admin-site`;

const adminEmail = `${runId}-admin@example.com`;
const editorEmail = `${runId}-editor@example.com`;

async function upsertSetting(key: string, value: string) {
  await setSettingByKey(key, value);
}

async function ensureUser(params: {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor";
  passwordHash: string;
}) {
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
    VALUES (${params.id}, ${params.email}, ${params.name}, ${params.role}, 'native', ${params.passwordHash}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = NOW()
  `;
}

async function ensureSite() {
  await sql`
    INSERT INTO tooty_sites ("id", "userId", "name", "subdomain", "isPrimary", "createdAt", "updatedAt")
    VALUES (${adminSiteId}, ${adminUserId}, ${"Auth Break Site"}, ${`${runId}-site`}, true, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "userId" = EXCLUDED."userId",
        "name" = EXCLUDED."name",
        "subdomain" = EXCLUDED."subdomain",
        "isPrimary" = EXCLUDED."isPrimary",
        "updatedAt" = NOW()
  `;
}

async function authenticateAs(page: Page, userId: string) {
  const token = `e2e-${randomUUID()}`;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await sql`
    INSERT INTO tooty_sessions ("sessionToken", "userId", "expires")
    VALUES (${token}, ${userId}, ${expires.toISOString()})
    ON CONFLICT ("sessionToken") DO UPDATE
    SET "userId" = EXCLUDED."userId", "expires" = EXCLUDED."expires"
  `;

  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "app.localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(expires.getTime() / 1000),
    },
  ]);
}

test.describe.configure({ mode: "serial" });
test.skip(!runAuthBreakE2E, "Set RUN_AUTH_BREAK_E2E=1 to run auth break e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for auth break e2e.",
);

test.beforeAll(async () => {
  const passwordHash = await hashPassword("password123");
  await upsertSetting("setup_completed", "true");
  await ensureUser({ id: adminUserId, email: adminEmail, name: "Auth Admin", role: "administrator", passwordHash });
  await ensureUser({ id: editorUserId, email: editorEmail, name: "Auth Editor", role: "editor", passwordHash });
  await ensureSite();
});

test("blocks editor from network plugin settings", async ({ page }) => {
  await authenticateAs(page, editorUserId);
  const response = await page.goto(`${appOrigin}/app/settings/plugins`);

  expect(response?.status()).toBe(404);
  await expect(page.getByText("404", { exact: false })).toBeVisible();
});

test("blocks editor from opening another user's site settings", async ({ page }) => {
  await authenticateAs(page, editorUserId);
  const response = await page.goto(`${appOrigin}/app/site/${adminSiteId}/settings/general`);

  expect(response?.status()).toBe(404);
  await expect(page.getByText("404", { exact: false })).toBeVisible();
});

test("rejects unauthorized network data-domain mutation API", async ({ page }) => {
  await authenticateAs(page, editorUserId);

  const denied = await page.request.post(`${appOrigin}/api/data-domains`, {
    data: { label: "Break Attempt" },
  });
  expect(denied.status()).toBe(403);

  await authenticateAs(page, adminUserId);
  const allowed = await page.request.post(`${appOrigin}/api/data-domains`, {
    data: { label: `Allowed ${runId}` },
  });
  expect(allowed.status()).toBe(201);
});
