import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteCommentTables } from "../../lib/site-comment-tables";
import { buildPublicOriginForSubdomain, getAdminBaseUrl, getAppOrigin, getPublicOrigin } from "./helpers/env";
import { addSessionTokenCookie } from "./helpers/auth";
import { buildProjectRunId, getProjectToken } from "./helpers/project-scope";
import {
  ensureFrontendBridgeAuth,
  gotoBridgeTarget,
} from "./helpers/auth-bridge";
import { ensureCommentsShellReady, gotoPublicTarget } from "./helpers/public-route";
import {
  ensureCoreSiteDomain,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureNetworkUserMeta,
  ensureSitePost,
  upsertSiteMeta,
} from "./helpers/storage";
import { tiptapParagraph } from "./helpers/tiptap";

let runId = "";
let postSlug = "";
let userId = "";
let domainPostId = "";
let userEmail = "";
const userName = "Comments Auth User";
const userDisplayName = "Comments Display Name";
const userUsername = "comments_auth_user";
let ghostUserId = "";
let ghostUserEmail = "";
const ghostUserName = "Ghost User Name";
const ghostUserDisplayName = "Ghost Display Name";
const ghostUserUsername = "ghost_comments_user";
const domainKey = "post";
const appOrigin = getAppOrigin();
const adminBaseUrl = getAdminBaseUrl();
let siteSubdomain = "";
let publicOrigin = "";

let siteId = "";
let postId = domainPostId;
let dataDomainId = 0;

async function withLockRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code || "")
          : "";
      if ((code !== "40P01" && code !== "55P03") || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  throw lastError;
}

async function ensureSite() {
  siteId = `${runId}-site`;
  await ensureNetworkSite({
    id: siteId,
    userId,
    name: "Comments Auth Site",
    subdomain: siteSubdomain,
    isPrimary: false,
  });
}

async function ensurePostDomain() {
  const row = await ensureCoreSiteDomain(siteId, "post");
  dataDomainId = Number(row.id || 0);
  if (!dataDomainId) throw new Error("Failed to create post data domain.");
}

async function ensureUser() {
  await ensureNetworkUser({
    id: userId,
    email: userEmail,
    name: userName,
    username: userUsername,
    role: "administrator",
    authProvider: "native",
  });
  await ensureNetworkUserMeta(userId, "display_name", userDisplayName);
}

async function ensurePost() {
  const content = tiptapParagraph("Comments auth test.");
  const inserted = await ensureSitePost({
    id: postId,
    siteId,
    domainKey,
    userId,
    slug: postSlug,
    title: "Comments Auth Test",
    description: "Auth mode test",
    content,
    published: true,
  });
  postId = String(inserted.id);
  await upsertSiteMeta({ siteId, domainKey, postId, key: "use_comments", value: "true" });
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
  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    expires,
  });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  runId = buildProjectRunId("e2e-comments-auth", testInfo.project.name);
  postSlug = `${runId}-post`;
  userId = `${runId}-user`;
  domainPostId = `${runId}-domain-post`;
  userEmail = `${runId}@example.com`;
  ghostUserId = `${runId}-ghost-user`;
  ghostUserEmail = `${runId}-ghost@example.com`;
  siteSubdomain = `ca-${getProjectToken(testInfo.project.name, 4)}-${runId.split("-").at(-1)?.slice(0, 6) || "site"}`;
  publicOrigin = buildPublicOriginForSubdomain(siteSubdomain);
  await withLockRetry(async () => {
    await ensureUser();
    await ensureSite();
    await ensurePostDomain();
    await ensurePost();
    await ensureCommentSettings();
  });
});

test("comments form shows anonymous identity inputs when logged out", async ({ page }) => {
  let publicPage = await gotoPublicTarget(await page.context().newPage(), `${publicOrigin}/post/${postSlug}`, 90_000);
  publicPage = await ensureCommentsShellReady(publicPage, `${publicOrigin}/post/${postSlug}`, 90_000);
  await expect(publicPage.locator(".tooty-post-auth, [data-theme-auth-greeting]").first()).toContainText("Login", { timeout: 20000 });
  await expect(publicPage.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(publicPage.locator("[data-comments-form] input[name='authorName']")).toBeVisible({ timeout: 30000 });
  await expect(publicPage.locator("[data-comments-form] input[name='authorEmail']")).toBeVisible({ timeout: 30000 });
});

test("comments form hides anonymous identity inputs when logged in", async ({ page }) => {
  await authenticateAs(page, userId);
  const postUrl = `${publicOrigin}/post/${postSlug}`;
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(postUrl)}`;
  let publicPage = await gotoBridgeTarget(await page.context().newPage(), bridgeStart);
  publicPage = await ensureFrontendBridgeAuth(publicPage, {
    displayName: userDisplayName,
    expectedPublicUrl: postUrl,
  });
  publicPage = await ensureCommentsShellReady(publicPage, postUrl, 90_000);
  await expect(publicPage.locator(".tooty-post-auth, [data-theme-auth-greeting]").first()).toContainText(`Hello ${userDisplayName}`, { timeout: 20000 });
  await expect(publicPage.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(publicPage.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(publicPage.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});

test("session token without DB user row is redirected to login before theme bridge handoff", async ({ page }) => {
  await authenticateAs(page, ghostUserId, {
    email: ghostUserEmail,
    name: ghostUserName,
    username: ghostUserUsername,
    displayName: ghostUserDisplayName,
  });
  const postUrl = `${publicOrigin}/post/${postSlug}`;
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(postUrl)}`;
  await page.goto(bridgeStart, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/cp\/login/);
  await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 20000 });
});

test("theme page remains responsive and does not spam auth session calls", async ({ page }) => {
  let authSessionRequests = 0;
  const publicPage = await page.context().newPage();
  publicPage.on("request", (request) => {
    if (request.url().includes("/api/auth/session")) {
      authSessionRequests += 1;
    }
  });

  let activePublicPage = await gotoPublicTarget(publicPage, `${publicOrigin}/post/${postSlug}`, 90_000);
  activePublicPage = await ensureCommentsShellReady(activePublicPage, `${publicOrigin}/post/${postSlug}`, 90_000);
  await expect(activePublicPage.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });

  // Let any late client tasks settle; persistent loops will keep incrementing request count.
  await activePublicPage.waitForTimeout(2500);

  // Basic event-loop health probe: 50ms timer should not be delayed dramatically.
  const timerLagMs = await activePublicPage.evaluate(async () => {
    const started = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return performance.now() - started;
  });

  // Synthetic contextmenu dispatch should complete quickly if the page is responsive.
  const contextMenuCount = await activePublicPage.evaluate(() => {
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
