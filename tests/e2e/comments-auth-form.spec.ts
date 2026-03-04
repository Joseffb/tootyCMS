import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteCommentTables } from "../../lib/site-comment-tables";
import { buildPublicOriginForSubdomain, getAdminBaseUrl, getAppHostname, getAppOrigin, getPublicOrigin } from "./helpers/env";

const runId = `e2e-comments-auth-${randomUUID()}`;
const postSlug = `${runId}-post`;
const userId = `${runId}-user`;
const domainPostId = `${runId}-domain-post`;
const userEmail = `${runId}@example.com`;
const userName = "Comments Auth User";
const userDisplayName = "Comments Display Name";
const userUsername = "comments_auth_user";
const ghostUserId = `${runId}-ghost-user`;
const ghostUserEmail = `${runId}-ghost@example.com`;
const ghostUserName = "Ghost User Name";
const ghostUserDisplayName = "Ghost Display Name";
const ghostUserUsername = "ghost_comments_user";
const domainKey = "post";
const appOrigin = getAppOrigin();
const adminBaseUrl = getAdminBaseUrl();
const appHostname = getAppHostname();
const siteSubdomain = `${runId}-site`;
const publicOrigin = buildPublicOriginForSubdomain(siteSubdomain);

let siteId = "";
let postId = domainPostId;
let dataDomainId = 0;

async function ensureSite() {
  siteId = `${runId}-site`;
  await sql`
    INSERT INTO tooty_sites ("id", "name", "subdomain", "isPrimary", "userId", "createdAt", "updatedAt")
    VALUES (${siteId}, ${"Comments Auth Site"}, ${siteSubdomain}, false, ${userId}, NOW(), NOW())
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
    VALUES (${userId}, ${userEmail}, ${userName}, ${userUsername}, 'administrator', 'native', NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "username" = EXCLUDED."username",
        "updatedAt" = NOW()
  `;
  await sql`
    DELETE FROM tooty_user_meta
    WHERE "userId" = ${userId} AND "key" = 'display_name'
  `;
  await sql`
    INSERT INTO tooty_user_meta ("userId", "key", "value", "createdAt", "updatedAt")
    VALUES (${userId}, 'display_name', ${userDisplayName}, NOW(), NOW())
  `;
}

async function ensurePost() {
  const content = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Comments auth test." }] }],
  });
  const inserted = await sql`
    INSERT INTO tooty_site_domain_posts
      ("id", "dataDomainId", "title", "description", "content", "slug", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${postId}, ${dataDomainId}, ${"Comments Auth Test"}, ${"Auth mode test"}, ${content}, ${postSlug}, true, ${siteId}, ${userId}, NOW(), NOW())
    RETURNING "id"
  `;
  postId = String(inserted.rows[0].id);
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
  await setSettingByKey("theme_tooty-light_enabled", "true");
  await setSettingByKey(`site_${siteId}_theme`, "tooty-light");
  await setSettingByKey("plugin_tooty-comments_enabled", "true");
  await setSettingByKey(`site_${siteId}_plugin_tooty-comments_enabled`, "true");
  await setSettingByKey(`site_${siteId}_writing_enable_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_authenticated_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_anonymous_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_show_comments_to_public`, "true");
  await ensureSiteCommentTables(siteId);
}

async function authenticateAs(
  page: Page,
  uid: string,
  domain: string,
  user?: { email?: string; name?: string; username?: string; displayName?: string },
) {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for comments auth e2e.");
  const email = user?.email || userEmail;
  const name = user?.name || userName;
  const username = user?.username || userUsername;
  const displayName = user?.displayName || userDisplayName;
  const token = await encode({
    secret,
    token: {
      sub: uid,
      email,
      name,
      role: "administrator",
      user: {
        id: uid,
        email,
        name,
        username,
        displayName,
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

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

test.beforeAll(async () => {
  await ensureUser();
  await ensureSite();
  await ensurePostDomain();
  await ensurePost();
  await ensureCommentSettings();
});

test("comments form shows anonymous identity inputs when logged out", async ({ page }) => {
  await page.goto(`${publicOrigin}/post/${postSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tooty-comments-title")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".tooty-post-auth")).toContainText("Login", { timeout: 20000 });
  await expect(page.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(page.locator("[data-comments-form] input[name='authorName']")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-comments-form] input[name='authorEmail']")).toBeVisible({ timeout: 30000 });
});

test("comments form hides anonymous identity inputs when logged in", async ({ page }) => {
  await authenticateAs(page, userId, appHostname);
  const postUrl = `${publicOrigin}/post/${postSlug}`;
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(postUrl)}`;
  await page.goto(bridgeStart, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tooty-comments-title")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".tooty-post-auth")).toContainText(`Hello ${userDisplayName}`, { timeout: 20000 });
  await expect(page.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});

test("session token without DB user row stays authenticated but cannot post as known user", async ({ page }) => {
  await authenticateAs(page, ghostUserId, appHostname, {
    email: ghostUserEmail,
    name: ghostUserName,
    username: ghostUserUsername,
    displayName: ghostUserDisplayName,
  });
  const postUrl = `${publicOrigin}/post/${postSlug}`;
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(postUrl)}`;
  await page.goto(bridgeStart, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tooty-comments-title")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeVisible({ timeout: 20000 });
});

test("theme page remains responsive and does not spam auth session calls", async ({ page }) => {
  let authSessionRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/session")) {
      authSessionRequests += 1;
    }
  });

  await page.goto(`${publicOrigin}/post/${postSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tooty-comments-title")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });

  // Let any late client tasks settle; persistent loops will keep incrementing request count.
  await page.waitForTimeout(2500);

  // Basic event-loop health probe: 50ms timer should not be delayed dramatically.
  const timerLagMs = await page.evaluate(async () => {
    const started = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return performance.now() - started;
  });

  // Synthetic contextmenu dispatch should complete quickly if the page is responsive.
  const contextMenuCount = await page.evaluate(() => {
    (window as any).__ctxCount = 0;
    document.body.addEventListener("contextmenu", () => {
      (window as any).__ctxCount += 1;
    });
    document.body.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window }),
    );
    return Number((window as any).__ctxCount || 0);
  });

  // Terminal trace values for regression debugging.
  console.log(
    `[theme-perf] authSessionRequests=${authSessionRequests} timerLagMs=${Math.round(timerLagMs)} contextMenuCount=${contextMenuCount}`,
  );

  expect(authSessionRequests).toBeLessThanOrEqual(3);
  expect(timerLagMs).toBeLessThan(500);
  expect(contextMenuCount).toBeGreaterThan(0);
});
