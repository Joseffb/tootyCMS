import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteCommentTables } from "../../lib/site-comment-tables";
import { buildPublicOriginForSubdomain, getAdminBaseUrl, getAppOrigin } from "./helpers/env";
import { ensureFrontendBridgeAuth, gotoBridgeTarget } from "./helpers/auth-bridge";
import { addSessionTokenCookie } from "./helpers/auth";
import { ensureCommentsShellReady } from "./helpers/public-route";
import { buildProjectRunId, getProjectToken } from "./helpers/project-scope";
import {
  ensureCoreSiteDomain,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureNetworkUserMeta,
  ensureSitePost,
  upsertSiteMeta,
} from "./helpers/storage";
import { tiptapParagraph } from "./helpers/tiptap";

const appOrigin = getAppOrigin();
const adminBaseUrl = getAdminBaseUrl();
const domainKey = "post";
let runId = "";
let postSlug = "";
let userId = "";
let email = "";
const password = "password123";
const displayName = "Bridge Display Name";
let siteSubdomain = "";
let publicOrigin = "";

let siteId = "";
let dataDomainId = 0;
let postId = "";
let seededPostId = "";

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for auth bridge e2e.",
);

async function ensureSite() {
  siteId = `${runId}-site`;
  await ensureNetworkSite({
    id: siteId,
    userId,
    name: "Auth Bridge Site",
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
    email,
    name: "Bridge User Name",
    username: "bridge_user_name",
    role: "administrator",
    authProvider: "native",
  });
  await ensureNetworkUserMeta(userId, "display_name", displayName);
}

async function ensurePost() {
  const content = tiptapParagraph("Bridge auth post.");
  const inserted = await ensureSitePost({
    id: seededPostId,
    siteId,
    domainKey,
    userId,
    slug: postSlug,
    title: "Bridge Auth Post",
    description: "Bridge auth test",
    content,
    published: true,
  });
  postId = String(inserted.id || "");
  if (!postId) throw new Error("Failed to create bridge auth post.");
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

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  runId = buildProjectRunId("e2e-auth-bridge", testInfo.project.name);
  postSlug = `${runId}-post`;
  userId = `${runId}-user`;
  email = `${runId}@example.com`;
  seededPostId = `${runId}-post-id`;
  siteSubdomain = `ab-${getProjectToken(testInfo.project.name, 4)}-${runId.split("-").at(-1)?.slice(0, 6) || "site"}`;
  publicOrigin = buildPublicOriginForSubdomain(siteSubdomain);
  await withLockRetry(async () => {
    await ensureUser();
    await ensureSite();
    await ensurePostDomain();
    await ensurePost();
    await ensureCommentSettings();
  });
});

async function authenticateAs(
  page: import("@playwright/test").Page,
  uid: string,
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
  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    expires,
  });
}

test("signin on app host is recognized on public post comments UI", async ({ page }) => {
  await authenticateAs(page, userId, {
    email,
    name: "Bridge User Name",
    username: "bridge_user_name",
    displayName,
  });
  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(`${publicOrigin}/post/${postSlug}`)}`;
  let publicPage = await gotoBridgeTarget(await page.context().newPage(), bridgeStart);
  publicPage = await ensureFrontendBridgeAuth(publicPage, {
    displayName,
    expectedPublicUrl: `${publicOrigin}/post/${postSlug}`,
  });
  publicPage = await ensureCommentsShellReady(publicPage, `${publicOrigin}/post/${postSlug}`, 90_000);
  await expect(publicPage.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });
  await expect(publicPage.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(publicPage.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});
