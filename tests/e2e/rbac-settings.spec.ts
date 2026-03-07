import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";
import { getAppOrigin } from "./helpers/env";
import { addSessionTokenCookie } from "./helpers/auth";
import {
  ensureNetworkSession,
  ensureNetworkSite,
  ensureNetworkUser,
  networkTableName,
  quotedIdentifier,
} from "./helpers/storage";

const runId = `e2e-rbac-${randomUUID()}`;
const appOrigin = getAppOrigin();
const adminEmail = `${runId}-admin@example.com`;
const adminUserId = `${runId}-admin-user`;
const adminSiteId = `${runId}-admin-site`;
const roleSlug = "seo-manager";
const runRbacE2E = process.env.RUN_RBAC_E2E === "1";

async function ensureSetupCompleted() {
  await setSettingByKey("setup_completed", "true");
}

async function ensureAdminUser(passwordHash: string) {
  await ensureNetworkUser({
    id: adminUserId,
    email: adminEmail,
    name: "RBAC Admin",
    role: "administrator",
    authProvider: "native",
    passwordHash,
  });
}

async function ensureAdminSite() {
  await ensureNetworkSite({
    id: adminSiteId,
    userId: adminUserId,
    name: "RBAC Site",
    subdomain: `${runId}-site`,
    isPrimary: false,
  });
}

async function authenticateAs(page: Page, userId: string) {
  const token = `e2e-${randomUUID()}`;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await ensureNetworkSession(token, userId, expires);
  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    expires: Math.floor(expires.getTime() / 1000),
  });
}

async function readCapability(role: string, capability: string) {
  const result = await sql.query(
    `SELECT "capabilities"->>$1 AS "enabled"
     FROM ${quotedIdentifier(networkTableName("rbac_roles"))}
     WHERE "role" = $2
     LIMIT 1`,
    [capability, role],
  );
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
