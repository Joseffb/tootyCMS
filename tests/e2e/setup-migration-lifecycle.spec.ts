import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { TARGET_DB_SCHEMA_VERSION } from "../../lib/db-health";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { getSettingByKey, setSettingByKey } from "../../lib/settings-store";
import { getAppOrigin } from "./helpers/env";
import { addSessionTokenCookie } from "./helpers/auth";
import { ensureNetworkSite, ensureNetworkUser } from "./helpers/storage";

const runId = `e2e-setup-migrate-${randomUUID()}`;
const appOrigin = getAppOrigin();
const runSetupMigrationE2E = process.env.RUN_SETUP_MIGRATION_E2E === "1";

const adminUserId = `${runId}-admin-user`;
const adminSiteId = `${runId}-admin-site`;
const adminEmail = `${runId}@example.com`;

async function upsertSetting(key: string, value: string) {
  await setSettingByKey(key, value);
}

async function readSetting(key: string) {
  return String((await getSettingByKey(key)) ?? "");
}

async function ensureAdminUserAndSite() {
  await ensureNetworkUser({
    id: adminUserId,
    email: adminEmail,
    name: "Setup Migration Admin",
    role: "administrator",
    authProvider: "native",
  });
  await ensureNetworkSite({
    id: adminSiteId,
    userId: adminUserId,
    name: "Setup Migration Site",
    subdomain: `${runId}-site`,
    isPrimary: false,
  });
}

async function authenticateAs(page: Page, userId: string) {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for setup migration e2e auth.");

  const token = await encode({
    secret,
    token: {
      sub: userId,
      email: adminEmail,
      name: "Setup Migration Admin",
      role: "administrator",
    },
    maxAge: 60 * 60 * 24,
  });

  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });
}

test.describe.configure({ mode: "serial" });
test.skip(!runSetupMigrationE2E, "Set RUN_SETUP_MIGRATION_E2E=1 to run setup/migration lifecycle e2e.");
test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for setup/migration lifecycle e2e.",
);

test.beforeAll(async () => {
  await ensureAdminUserAndSite();
  await upsertSetting("setup_completed", "true");
  await upsertSetting("setup_lifecycle_state", "ready");
  await upsertSetting("db_schema_target_version", TARGET_DB_SCHEMA_VERSION);
});

test("database update required flow applies migration and records schema version", async ({ page }) => {
  await upsertSetting("db_schema_version", "2025.01.01.0");

  await authenticateAs(page, adminUserId);
  const navBefore = await page.request.get(`${appOrigin}/api/nav/context`);
  expect(navBefore.ok()).toBe(true);
  const navBeforeJson = await navBefore.json();
  expect(Boolean(navBeforeJson?.migrationRequired)).toBe(true);
  await page.goto(`${appOrigin}/app/settings/database`);
  await expect(page).toHaveURL(/\/app\/settings\/database/);

  await expect(page.getByRole("button", { name: "Apply Database Update" })).toBeVisible();

  await page.getByRole("button", { name: "Apply Database Update" }).click();

  await expect(page).toHaveURL(/\/app\/settings\/database/);
  await expect.poll(async () => readSetting("db_schema_version")).toBe(TARGET_DB_SCHEMA_VERSION);
  const navAfter = await page.request.get(`${appOrigin}/api/nav/context`);
  expect(navAfter.ok()).toBe(true);
  const navAfterJson = await navAfter.json();
  expect(Boolean(navAfterJson?.migrationRequired)).toBe(false);
});
