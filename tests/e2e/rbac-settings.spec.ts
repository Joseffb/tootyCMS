import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { randomUUID } from "node:crypto";

const runId = `e2e-rbac-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const adminEmail = `${runId}-admin@example.com`;
const adminUserId = `${runId}-admin-user`;
const adminSiteId = `${runId}-admin-site`;
const roleSlug = "seo-manager";
const runRbacE2E = process.env.RUN_RBAC_E2E === "1";

async function ensureSetupCompleted() {
  await sql`
    INSERT INTO tooty_cms_settings ("key", "value")
    VALUES ('setup_completed', 'true')
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
  `;
}

async function ensureAdminUser(passwordHash: string) {
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
    VALUES (${adminUserId}, ${adminEmail}, ${"RBAC Admin"}, 'administrator', 'native', ${passwordHash}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = NOW()
  `;
}

async function ensureAdminSite() {
  await sql`
    INSERT INTO tooty_sites ("id", "userId", "name", "subdomain", "isPrimary", "createdAt", "updatedAt")
    VALUES (${adminSiteId}, ${adminUserId}, ${"RBAC Site"}, ${`${runId}-site`}, true, NOW(), NOW())
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

async function readCapability(role: string, capability: string) {
  const result = await sql`
    SELECT "capabilities"->>${capability} AS "enabled"
    FROM tooty_rbac_roles
    WHERE "role" = ${role}
    LIMIT 1
  `;
  return String(result.rows[0]?.enabled ?? "");
}

test.describe.configure({ mode: "serial" });
test.skip(!runRbacE2E, "Set RUN_RBAC_E2E=1 to run rbac settings e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for rbac e2e.",
);

test.beforeAll(async () => {
  const passwordHash = await hashPassword("password123");
  await ensureSetupCompleted();
  await ensureAdminUser(passwordHash);
  await ensureAdminSite();
});

test("rbac settings: tabs and role assignments default tab", async ({ page }) => {
  await authenticateAs(page, adminUserId);
  await page.goto(`${appOrigin}/app/settings/rbac`);
  await expect(page.getByRole("link", { name: "Role Assignments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Capability Matrix" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Role Assignments" })).toBeVisible();
});

test("rbac settings: typeahead open creates role and loads matrix", async ({ page }) => {
  await authenticateAs(page, adminUserId);
  await page.goto(`${appOrigin}/app/settings/rbac?tab=matrix`);
  await page.getByPlaceholder("e.g. seo-manager").fill(roleSlug);
  await page.getByRole("button", { name: "Open Role" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/settings/rbac\\?tab=matrix&role=${roleSlug}`));
  await expect(page.getByText("Editing", { exact: false })).toBeVisible();
});

test("rbac settings: capability enabled toggle auto-saves one line", async ({ page }) => {
  await authenticateAs(page, adminUserId);
  await page.goto(`${appOrigin}/app/settings/rbac?tab=matrix&role=${roleSlug}`);

  const row = page.locator("tr", { hasText: "site.plugins.manage" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Enabled" }).click();

  await expect.poll(async () => readCapability(roleSlug, "site.plugins.manage")).toBe("true");
});
