import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sql, sqlClient } from "./helpers/vercel-sql";
import { networkTableName, quotedIdentifier } from "./helpers/storage";

const runId = `e2e-setup-${randomUUID()}`;
const adminEmail = `${runId}@example.com`;
const adminPassword = "password123";
const runSetupFlow = process.env.RUN_SETUP_FLOW_E2E === "1";

async function resetTootyTables() {
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("accounts"))}`);
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("sessions"))}`);
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("verification_tokens"))}`);
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("sites"))}`);
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("users"))}`);
  await sqlClient.query(`DELETE FROM ${quotedIdentifier(networkTableName("system_settings"))}`);
  await sql`
    DO $$
    DECLARE
      record_row RECORD;
    BEGIN
      FOR record_row IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename ~ '^tooty_site_.*$'
      LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', record_row.tablename);
      END LOOP;
    END
    $$;
  `;
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
