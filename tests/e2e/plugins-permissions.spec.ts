import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { getAvailablePlugins } from "../../lib/plugins";
import { randomUUID } from "node:crypto";

const runId = `e2e-plugins-${Date.now()}`;
const password = "password123";
let pluginId = "";
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const runPluginPermsE2E = process.env.RUN_PLUGIN_PERMS_E2E === "1";

const singleEmail = `${runId}-single@example.com`;
const siteAdminEmail = `${runId}-site-admin@example.com`;
const networkAdminEmail = `${runId}-network-admin@example.com`;

const singleUserId = `${runId}-single-user`;
const siteAdminUserId = `${runId}-site-admin-user`;
const networkAdminUserId = `${runId}-network-admin-user`;

const singleSiteId = `${runId}-single-site`;
const siteAdminMainSiteId = `${runId}-site-admin-main`;
const siteAdminSecondSiteId = `${runId}-site-admin-second`;
const networkMainSiteId = `${runId}-network-main`;
const networkSecondSiteId = `${runId}-network-second`;

const globalEnabledKey = () => `plugin_${pluginId}_enabled`;
const globalNetworkRequiredKey = () => `plugin_${pluginId}_network_required`;
const siteEnabledKey = (siteId: string) => `site_${siteId}_plugin_${pluginId}_enabled`;

async function upsertSetting(key: string, value: string) {
  await sql`
    INSERT INTO tooty_cms_settings ("key", "value")
    VALUES (${key}, ${value})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
  `;
}

async function readSetting(key: string) {
  const result = await sql`SELECT "value" FROM tooty_cms_settings WHERE "key" = ${key} LIMIT 1`;
  return String(result.rows[0]?.value ?? "");
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

async function ensureSite(params: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  isPrimary: boolean;
}) {
  await sql`
    INSERT INTO tooty_sites ("id", "userId", "name", "subdomain", "isPrimary", "createdAt", "updatedAt")
    VALUES (${params.id}, ${params.userId}, ${params.name}, ${params.subdomain}, ${params.isPrimary}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "userId" = EXCLUDED."userId",
        "name" = EXCLUDED."name",
        "subdomain" = EXCLUDED."subdomain",
        "isPrimary" = EXCLUDED."isPrimary",
        "updatedAt" = NOW()
  `;
}

async function authenticateAs(page: Page, userId: string) {
  const sessionToken = `e2e-${randomUUID()}`;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await sql`
    INSERT INTO tooty_sessions ("sessionToken", "userId", "expires")
    VALUES (${sessionToken}, ${userId}, ${expires.toISOString()})
    ON CONFLICT ("sessionToken") DO UPDATE
    SET "userId" = EXCLUDED."userId", "expires" = EXCLUDED."expires"
  `;
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
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
test.skip(!runPluginPermsE2E, "Set RUN_PLUGIN_PERMS_E2E=1 to run plugin permissions e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for plugin permissions e2e.",
);

test.beforeAll(async () => {
  const discovered = await getAvailablePlugins();
  pluginId =
    discovered.find((plugin) => plugin.id === "hello-teety")?.id ||
    discovered.find((plugin) => plugin.id === "dev-tools")?.id ||
    discovered[0]?.id ||
    "";

  const passwordHash = await hashPassword(password);
  await upsertSetting("setup_completed", "true");

  await ensureUser({
    id: singleUserId,
    email: singleEmail,
    name: "Single User",
    role: "administrator",
    passwordHash,
  });
  await ensureUser({
    id: siteAdminUserId,
    email: siteAdminEmail,
    name: "Site Admin User",
    role: "editor",
    passwordHash,
  });
  await ensureUser({
    id: networkAdminUserId,
    email: networkAdminEmail,
    name: "Network Admin User",
    role: "administrator",
    passwordHash,
  });

  await ensureSite({
    id: singleSiteId,
    userId: singleUserId,
    name: "Single Site",
    subdomain: `${runId}-single`,
    isPrimary: true,
  });
  await ensureSite({
    id: siteAdminMainSiteId,
    userId: siteAdminUserId,
    name: "Site Admin Main",
    subdomain: `${runId}-sa-main`,
    isPrimary: true,
  });
  await ensureSite({
    id: siteAdminSecondSiteId,
    userId: siteAdminUserId,
    name: "Site Admin Second",
    subdomain: `${runId}-sa-second`,
    isPrimary: false,
  });
  await ensureSite({
    id: networkMainSiteId,
    userId: networkAdminUserId,
    name: "Network Main",
    subdomain: `${runId}-na-main`,
    isPrimary: true,
  });
  await ensureSite({
    id: networkSecondSiteId,
    userId: networkAdminUserId,
    name: "Network Second",
    subdomain: `${runId}-na-second`,
    isPrimary: false,
  });
});

test("single-site plugins: can toggle enabled from site plugins view", async ({ page }) => {
  test.skip(!pluginId, "No plugins discovered for e2e plugin permissions test.");
  await upsertSetting(globalEnabledKey(), "true");
  await upsertSetting(globalNetworkRequiredKey(), "false");
  await upsertSetting(siteEnabledKey(singleSiteId), "true");

  await authenticateAs(page, singleUserId);
  await page.goto(`${appOrigin}/app/site/${singleSiteId}/settings/plugins?tab=installed&view=all`);
  const row = page.locator("tr", { hasText: pluginId }).first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Enabled" }).click();
  await expect.poll(async () => readSetting(siteEnabledKey(singleSiteId))).toBe("false");

  await row.getByRole("button", { name: "Enabled" }).click();
  await expect.poll(async () => readSetting(siteEnabledKey(singleSiteId))).toBe("true");
});

test("multisite site plugins: site admin can toggle enabled, but networkRequired stays read-only", async ({ page }) => {
  test.skip(!pluginId, "No plugins discovered for e2e plugin permissions test.");
  await upsertSetting(globalEnabledKey(), "true");
  await upsertSetting(globalNetworkRequiredKey(), "false");
  await upsertSetting(siteEnabledKey(siteAdminMainSiteId), "true");

  await authenticateAs(page, siteAdminUserId);
  await page.goto(`${appOrigin}/app/site/${siteAdminMainSiteId}/settings/plugins?tab=installed&view=all`);
  const row = page.locator("tr", { hasText: pluginId }).first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Enabled" }).click();
  await expect.poll(async () => readSetting(siteEnabledKey(siteAdminMainSiteId))).toBe("false");

  await expect(row.getByRole("button", { name: "Network" })).toBeDisabled();

  await upsertSetting(globalNetworkRequiredKey(), "true");
  await page.reload();
  const requiredRow = page.locator("tr", { hasText: pluginId }).first();
  await expect(requiredRow.getByRole("button", { name: "Enabled" })).toBeDisabled();
});

test("multisite global + site plugins: network admin can toggle networkRequired and per-site disable", async ({ page }) => {
  test.skip(!pluginId, "No plugins discovered for e2e plugin permissions test.");
  await upsertSetting(globalEnabledKey(), "true");
  await upsertSetting(globalNetworkRequiredKey(), "true");
  await upsertSetting(siteEnabledKey(networkMainSiteId), "true");

  await authenticateAs(page, networkAdminUserId);

  await page.goto(`${appOrigin}/app/site/${networkMainSiteId}/settings/plugins?tab=installed&view=all`);
  const siteRow = page.locator("tr", { hasText: pluginId }).first();
  await expect(siteRow).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await siteRow.getByRole("button", { name: "Enabled" }).click();
  await expect.poll(async () => readSetting(siteEnabledKey(networkMainSiteId))).toBe("false");

  await siteRow.getByRole("button", { name: "Network" }).click();
  await expect.poll(async () => readSetting(globalNetworkRequiredKey())).toBe("false");

  await page.goto(`${appOrigin}/app/settings/plugins?tab=installed&view=all`);
  const globalRow = page.locator("tr", { hasText: pluginId }).first();
  await expect(globalRow).toBeVisible();
  await globalRow.getByRole("button", { name: "Enabled" }).click();
  await expect.poll(async () => readSetting(globalEnabledKey())).toBe("false");
});
