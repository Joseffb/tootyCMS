import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";

const runId = `e2e-setup-${Date.now()}`;
const adminEmail = `${runId}@example.com`;
const adminPassword = "password123";
const runSetupFlow = process.env.RUN_SETUP_FLOW_E2E === "1";

async function resetTootyTables() {
  await sql`DELETE FROM tooty_domain_post_meta`;
  await sql`DELETE FROM tooty_post_categories`;
  await sql`DELETE FROM tooty_term_relationships`;
  await sql`DELETE FROM tooty_term_taxonomy_domains`;
  await sql`DELETE FROM tooty_term_taxonomies`;
  await sql`DELETE FROM tooty_domain_posts`;
  await sql`DELETE FROM tooty_posts`;
  await sql`DELETE FROM tooty_media`;
  await sql`DELETE FROM tooty_site_data_domains`;
  await sql`DELETE FROM tooty_accounts`;
  await sql`DELETE FROM tooty_sessions`;
  await sql`DELETE FROM "tooty_verificationTokens"`;
  await sql`DELETE FROM tooty_sites`;
  await sql`DELETE FROM tooty_users`;
  await sql`DELETE FROM tooty_cms_settings`;
}

test.describe.configure({ mode: "serial" });
test.skip(!runSetupFlow, "Set RUN_SETUP_FLOW_E2E=1 to run destructive setup flow e2e.");

test.beforeAll(async () => {
  await resetTootyTables();
});

test("fresh setup creates admin and routes to authenticated entry", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "First-Run Setup" })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Site Owner").fill("E2E Admin");
  await page.getByPlaceholder("you@example.com").fill(adminEmail);
  await page.getByPlaceholder("+1 555 123 4567").fill("+15551234567");
  await page.getByPlaceholder("At least 8 characters").fill(adminPassword);
  await page.getByPlaceholder("Repeat password").fill(adminPassword);
  await page.getByRole("button", { name: "Continue" }).click();

  // First click arms finish intent, second click submits.
  await page.getByRole("button", { name: "Finish Setup" }).click();
  if ((page.url() || "").includes("/setup")) {
    await page
      .getByRole("button", { name: /Finish Setup|Finishing/ })
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }

  await page.waitForURL(/\/(app|login)/, { timeout: 30_000 });
  if ((page.url() || "").includes("/login")) {
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    return;
  }

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
