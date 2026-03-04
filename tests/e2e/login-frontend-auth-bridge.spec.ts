import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteCommentTables } from "../../lib/site-comment-tables";
import { buildPublicOriginForSubdomain, getAdminBaseUrl, getAppHostname, getAppOrigin } from "./helpers/env";

const runId = `e2e-auth-bridge-${randomUUID()}`;
const appOrigin = getAppOrigin();
const adminBaseUrl = getAdminBaseUrl();
const appHostname = getAppHostname();
const domainKey = "post";
const postSlug = `${runId}-post`;
const userId = `${runId}-user`;
const email = `${runId}@example.com`;
const password = "password123";
const displayName = "Bridge Display Name";
const siteSubdomain = `${runId}-site`;
const publicOrigin = buildPublicOriginForSubdomain(siteSubdomain);

let siteId = "";
let dataDomainId = 0;
let postId = "";
const seededPostId = `${runId}-post-id`;

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for auth bridge e2e.",
);

async function ensureSite() {
  siteId = `${runId}-site`;
  await sql`
    INSERT INTO tooty_sites ("id", "name", "subdomain", "isPrimary", "userId", "createdAt", "updatedAt")
    VALUES (${siteId}, ${"Auth Bridge Site"}, ${siteSubdomain}, false, ${userId}, NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "name" = EXCLUDED."name",
        "subdomain" = EXCLUDED."subdomain",
        "isPrimary" = EXCLUDED."isPrimary",
        "userId" = EXCLUDED."userId",
        "updatedAt" = NOW()
  `;
}

async function ensurePostDomain() {
  const rows = await sql`
    SELECT "id"
    FROM tooty_site_data_domains
    WHERE "key" = ${domainKey}
    LIMIT 1
  `;
  if (rows.rows[0]?.id) {
    dataDomainId = Number(rows.rows[0].id);
    return;
  }
  const fallback = await sql`
    SELECT "id"
    FROM tooty_site_data_domains
    WHERE "contentTable" = 'tooty_site_domain_posts'
    LIMIT 1
  `;
  if (fallback.rows[0]?.id) {
    dataDomainId = Number(fallback.rows[0].id);
    return;
  }
  try {
    const inserted = await sql`
      INSERT INTO tooty_site_data_domains ("key", "label", "contentTable", "metaTable", "createdAt", "updatedAt")
      VALUES ('post', 'Posts', 'tooty_site_domain_posts', 'tooty_site_domain_post_meta', NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE
      SET "label" = EXCLUDED."label",
          "contentTable" = EXCLUDED."contentTable",
          "metaTable" = EXCLUDED."metaTable",
          "updatedAt" = NOW()
      RETURNING "id"
    `;
    dataDomainId = Number(inserted.rows[0]?.id || 0);
  } catch {
    const retry = await sql`
      SELECT "id"
      FROM tooty_site_data_domains
      WHERE "key" = ${domainKey} OR "contentTable" = 'tooty_site_domain_posts'
      LIMIT 1
    `;
    dataDomainId = Number(retry.rows[0]?.id || 0);
  }
  if (!dataDomainId) throw new Error("Failed to create post data domain.");
}

async function ensureUser() {
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "username", "role", "authProvider", "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, ${"Bridge User Name"}, ${"bridge_user_name"}, 'administrator', 'native', NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "username" = EXCLUDED."username",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
        "updatedAt" = NOW()
  `;
  await sql`
    DELETE FROM tooty_user_meta
    WHERE "userId" = ${userId} AND "key" = 'display_name'
  `;
  await sql`
    INSERT INTO tooty_user_meta ("userId", "key", "value", "createdAt", "updatedAt")
    VALUES (${userId}, 'display_name', ${displayName}, NOW(), NOW())
  `;
}

async function ensurePost() {
  const content = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Bridge auth post." }] }],
  });
  const inserted = await sql`
    INSERT INTO tooty_site_domain_posts
      ("id", "dataDomainId", "title", "description", "content", "slug", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${seededPostId}, ${dataDomainId}, ${"Bridge Auth Post"}, ${"Bridge auth test"}, ${content}, ${postSlug}, true, ${siteId}, ${userId}, NOW(), NOW())
    RETURNING "id"
  `;
  postId = String(inserted.rows[0]?.id || "");
  if (!postId) throw new Error("Failed to create bridge auth post.");
  await sql`
    DELETE FROM tooty_site_domain_post_meta
    WHERE "domainPostId" = ${postId} AND "key" = 'use_comments'
  `;
  await sql`
    INSERT INTO tooty_site_domain_post_meta ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES (${postId}, 'use_comments', 'true', NOW(), NOW())
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
  await ensureSiteCommentTables(siteId);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

async function gotoBridgeTarget(page: import("@playwright/test").Page, href: string) {
  await page.goto(href, { waitUntil: "commit", timeout: 5_000 }).catch((error) => {
    const message = String(error instanceof Error ? error.message : error);
    if (
      message.includes("ERR_ABORTED") ||
      message.includes("NS_BINDING_ABORTED") ||
      message.toLowerCase().includes("interrupted by another navigation") ||
      message.toLowerCase().includes("timeout")
    ) {
      return null;
    }
    throw error;
  });
}

test.beforeAll(async () => {
  await ensureUser();
  await ensureSite();
  await ensurePostDomain();
  await ensurePost();
  await ensureCommentSettings();
});

async function ensureFrontendBridgeAuth(page: import("@playwright/test").Page) {
  const authNode = page.locator(".tooty-post-auth");
  await expect(authNode).toBeVisible({ timeout: 20000 });
  const loginLink = authNode.getByRole("link", { name: "Login" }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await loginLink.count()) {
      const loginVisible = await loginLink.isVisible().catch(() => false);
      if (loginVisible) {
        const href = await loginLink.getAttribute("href");
        if (href) {
          await gotoBridgeTarget(page, href);
        }
      }
    }
    const bridged = await page
      .waitForFunction((expectedDisplayName) => {
        const auth = (window as any).__tootyFrontendAuth;
        if (auth?.token) return true;
        const raw = window.localStorage.getItem("tooty.themeAuthBridge.v1");
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (String(parsed?.token || "").trim()) return true;
          } catch {
            // ignore malformed transient storage payload
          }
        }
        const authEl = document.querySelector(".tooty-post-auth");
        return Boolean(authEl?.textContent?.includes(`Hello ${expectedDisplayName}`));
      }, displayName, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (bridged) break;
    if (attempt < 2) {
      await page.waitForTimeout(150 * (attempt + 1));
    }
  }
  await expect(authNode).toContainText(`Hello ${displayName}`, { timeout: 20000 });
}

async function authenticateAs(
  page: import("@playwright/test").Page,
  uid: string,
  domain: string,
  user: { email: string; name: string; username: string; displayName: string },
) {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for auth bridge e2e.");
  const token = await encode({
    secret,
    token: {
      sub: uid,
      email: user.email,
      name: user.name,
      role: "administrator",
      user: {
        id: uid,
        email: user.email,
        name: user.name,
        username: user.username,
        displayName: user.displayName,
        role: "administrator",
      },
    },
    maxAge: 60 * 60 * 24,
  });
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires,
    },
  ]);
}

test("signin on app host is recognized on public post comments UI", async ({ page }) => {
  await authenticateAs(page, userId, appHostname, {
    email,
    name: "Bridge User Name",
    username: "bridge_user_name",
    displayName,
  });
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(`${publicOrigin}/post/${postSlug}`)}`;
  await gotoBridgeTarget(page, bridgeStart);
  await ensureFrontendBridgeAuth(page);
  await expect(page.locator(".tooty-comments-title")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});
