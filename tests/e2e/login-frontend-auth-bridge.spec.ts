import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { hashPassword } from "../../lib/password";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-auth-bridge-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const publicOrigin = process.env.E2E_PUBLIC_ORIGIN || "http://localhost:3000";
const domainKey = "post";
const postSlug = `${runId}-post`;
const userId = `${runId}-user`;
const email = `${runId}@example.com`;
const password = "password123";
const displayName = "Bridge Display Name";

let siteId = "";
let dataDomainId = 0;
let postId = "";
const seededPostId = `${runId}-post-id`;

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for auth bridge e2e.",
);

async function ensureMainSite() {
  const rows = await sql`
    SELECT "id"
    FROM tooty_sites
    WHERE "isPrimary" = true OR "subdomain" = 'main'
    ORDER BY "isPrimary" DESC, "createdAt" ASC
    LIMIT 1
  `;
  if (!rows.rows[0]?.id) throw new Error("Primary/main site not found.");
  siteId = String(rows.rows[0].id);
}

async function ensurePostDomain() {
  const rows = await sql`
    SELECT "id"
    FROM tooty_data_domains
    WHERE "key" = ${domainKey}
    LIMIT 1
  `;
  if (!rows.rows[0]?.id) throw new Error("Post data domain not found.");
  dataDomainId = Number(rows.rows[0].id);
}

async function ensureUser() {
  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "username", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, ${"Bridge User Name"}, ${"bridge_user_name"}, 'administrator', 'native', ${passwordHash}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "username" = EXCLUDED."username",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = NOW()
  `;
  await sql`
    INSERT INTO tooty_user_meta ("userId", "key", "value", "createdAt", "updatedAt")
    VALUES (${userId}, 'display_name', ${displayName}, NOW(), NOW())
    ON CONFLICT ("userId", "key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = NOW()
  `;
}

async function ensurePost() {
  const content = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Bridge auth post." }] }],
  });
  const inserted = await sql`
    INSERT INTO tooty_domain_posts
      ("id", "dataDomainId", "title", "description", "content", "slug", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${seededPostId}, ${dataDomainId}, ${"Bridge Auth Post"}, ${"Bridge auth test"}, ${content}, ${postSlug}, true, ${siteId}, ${userId}, NOW(), NOW())
    RETURNING "id"
  `;
  postId = String(inserted.rows[0]?.id || "");
  if (!postId) throw new Error("Failed to create bridge auth post.");
  await sql`
    INSERT INTO tooty_domain_post_meta ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES (${postId}, 'use_comments', 'true', NOW(), NOW())
    ON CONFLICT ("domainPostId", "key")
    DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;
}

async function ensureCommentSettings() {
  await setSettingByKey("setup_completed", "true");
  await setSettingByKey("plugin_tooty-comments_enabled", "true");
  await setSettingByKey(`site_${siteId}_plugin_tooty-comments_enabled`, "true");
  await setSettingByKey(`site_${siteId}_writing_enable_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_authenticated_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_anonymous_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_show_comments_to_public`, "true");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureMainSite();
  await ensurePostDomain();
  await ensureUser();
  await ensurePost();
  await ensureCommentSettings();
});

test.afterAll(async () => {
  if (postId) {
    await sql`DELETE FROM tooty_domain_post_meta WHERE "domainPostId" = ${postId}`;
    await sql`DELETE FROM tooty_domain_posts WHERE "id" = ${postId}`;
  }
  await sql`DELETE FROM tooty_user_meta WHERE "userId" = ${userId} AND "key" = 'display_name'`;
  await sql`DELETE FROM tooty_users WHERE "id" = ${userId}`;
});

async function ensureFrontendBridgeAuth(page: import("@playwright/test").Page) {
  const authNode = page.locator(".tooty-post-auth");
  await expect(authNode).toBeVisible({ timeout: 20000 });
  const loginLink = authNode.getByRole("link", { name: "Login" });
  if (await loginLink.count()) {
    await Promise.all([
      page.waitForURL(new RegExp(`/post/${postSlug}`), { timeout: 30000 }),
      loginLink.click(),
    ]);
  }
  await expect(authNode).toContainText(`Hello ${displayName}`, { timeout: 20000 });
}

test("signin on app.localhost is recognized on localhost post comments UI", async ({ page }) => {
  await page.goto(`${appOrigin}/login`);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login with Email" }).click();
  await page.waitForURL(/\/app(\/.*)?$/i, { timeout: 20000 });

  await page.goto(`${publicOrigin}/post/${postSlug}`);
  await ensureFrontendBridgeAuth(page);
  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});
