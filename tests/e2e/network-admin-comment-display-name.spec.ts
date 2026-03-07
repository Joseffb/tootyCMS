import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteCommentTables } from "../../lib/site-comment-tables";
import { buildPublicOriginForSubdomain, getAdminBaseUrl, getAppOrigin } from "./helpers/env";
import { ensureFrontendBridgeAuth, gotoBridgeTarget } from "./helpers/auth-bridge";
import { ensureCommentsShellReady } from "./helpers/public-route";
import { addSessionTokenCookie } from "./helpers/auth";
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

const adminBaseUrl = getAdminBaseUrl();
const appOrigin = getAppOrigin();
let runId = "";
let siteSubdomain = "";
let publicOrigin = "";
let publicHostname = "";
let postSlug = "";

let userId = "";
let email = "";
const password = "password123";
const realName = "Network Admin Real Name";
const displayName = "Network Admin Display Name";
let username = "";

let siteId = "";
let postId = "";
let dataDomainId = 0;

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for network admin comment display-name e2e.",
);

test.setTimeout(120_000);

async function ensureSite() {
  siteId = `${runId}-site`;
  await ensureNetworkSite({
    id: siteId,
    userId,
    name: "Network Admin Comment Site",
    subdomain: siteSubdomain,
    isPrimary: false,
  });
}

async function resolvePostDomain() {
  const row = await ensureCoreSiteDomain(siteId, "post");
  dataDomainId = Number(row.id || 0);
  if (!dataDomainId) throw new Error("Failed to resolve post data domain in test DB.");
}

async function createPost() {
  const content = tiptapParagraph("E2E seeded post for network admin comment test.");
  const insert = await ensureSitePost({
    id: `${runId}-post`,
    siteId,
    domainKey: "post",
    userId,
    slug: postSlug,
    title: "Network Admin Comment Test Post",
    description: "Seeded by e2e",
    content,
    published: true,
  });
  postId = String(insert.id || "");
  if (!postId) throw new Error("Failed to create seeded post.");
  await upsertSiteMeta({ siteId, domainKey: "post", postId, key: "use_comments", value: "true" });
}

async function ensureNetworkAdminUser() {
  await ensureNetworkUser({
    id: userId,
    email,
    name: realName,
    username,
    role: "network admin",
    authProvider: "native",
  });
  await ensureNetworkUserMeta(userId, "display_name", displayName);
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

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  runId = buildProjectRunId("e2e-network-admin-comment", testInfo.project.name);
  siteSubdomain = `na-${getProjectToken(testInfo.project.name, 4)}-${runId.split("-").at(-1)?.slice(0, 6) || "site"}`;
  publicOrigin = buildPublicOriginForSubdomain(siteSubdomain);
  publicHostname = new URL(publicOrigin).hostname;
  postSlug = `${runId}-post`;
  userId = `${runId}-user`;
  email = `${runId}@example.com`;
  username = `${runId}-username`;
  await ensureNetworkAdminUser();
  await ensureSite();
  await resolvePostDomain();
  await createPost();
  await ensureCommentSettings();
});

async function authenticateAs(
  page: import("@playwright/test").Page,
  uid: string,
  user: { email: string; name: string; username: string; displayName: string },
) {
  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for network admin comment e2e.");
  const token = await encode({
    secret,
    token: {
      sub: uid,
      email: user.email,
      name: user.name,
      role: "network admin",
      user: {
        id: uid,
        email: user.email,
        name: user.name,
        username: user.username,
        displayName: user.displayName,
        role: "network admin",
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

test("frontend post comment form uses network admin display_name and hides anonymous inputs", async ({ page }) => {
  await authenticateAs(page, userId, {
    email,
    name: realName,
    username,
    displayName,
  });

  const bridgeStart = `${adminBaseUrl}/theme-bridge-start?return=${encodeURIComponent(`${publicOrigin}/post/${postSlug}`)}`;
  let publicPage = await gotoBridgeTarget(await page.context().newPage(), bridgeStart);

  publicPage = await ensureFrontendBridgeAuth(publicPage, {
    displayName,
    expectedPublicUrl: `${publicOrigin}/post/${postSlug}`,
  });
  const authNode = publicPage.locator(".tooty-post-auth, [data-theme-auth-greeting]").first();
  await expect(authNode).not.toContainText(realName, { timeout: 20_000 });
  await expect(authNode).toContainText(`Hello ${displayName}`, { timeout: 20_000 });
  publicPage = await ensureCommentsShellReady(publicPage, `${publicOrigin}/post/${postSlug}`, 90_000);
  await expect(publicPage.locator("[data-comments-note]")).not.toContainText(/loading comments|retrying comments/i, { timeout: 45000 });

  await expect(publicPage.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(publicPage.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});
