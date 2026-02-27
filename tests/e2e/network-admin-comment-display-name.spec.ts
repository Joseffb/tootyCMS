import { expect, test } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-network-admin-comment-${Date.now()}`;
const appOrigin = process.env.E2E_APP_ORIGIN || "http://app.localhost:3000";
const publicOrigin = process.env.E2E_PUBLIC_ORIGIN || "http://localhost:3000";
const postSlug = `${runId}-post`;

const userId = `${runId}-user`;
const email = `${runId}@example.com`;
const password = "password123";
const realName = "Network Admin Real Name";
const displayName = "Network Admin Display Name";
const username = `${runId}-username`;

let siteId = "";
let postId = "";
let dataDomainId = 0;

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for network admin comment display-name e2e.",
);

async function resolveSite() {
  const mainRows = await sql`
    SELECT "id"
    FROM tooty_sites
    WHERE "subdomain" = 'main'
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  if (mainRows.rows[0]?.id) {
    siteId = String(mainRows.rows[0].id);
    return;
  }

  const rows = await sql`
    SELECT "id"
    FROM tooty_sites
    WHERE "isPrimary" = true OR "subdomain" = 'main'
    ORDER BY "isPrimary" DESC, "createdAt" ASC
    LIMIT 1
  `;
  if (rows.rows[0]?.id) {
    siteId = String(rows.rows[0].id);
    await sql`
      UPDATE tooty_sites
      SET "subdomain" = 'main', "isPrimary" = true, "updatedAt" = NOW()
      WHERE "id" = ${siteId}
    `;
    return;
  }

  siteId = `${runId}-site-main`;
  const upserted = await sql`
    INSERT INTO tooty_sites ("id", "name", "subdomain", "isPrimary", "userId", "createdAt", "updatedAt")
    VALUES (${siteId}, ${"Main Site"}, 'main', true, ${userId}, NOW(), NOW())
    ON CONFLICT ("subdomain") DO UPDATE
    SET "name" = EXCLUDED."name",
        "isPrimary" = EXCLUDED."isPrimary",
        "updatedAt" = NOW()
    RETURNING "id"
  `;
  if (upserted.rows[0]?.id) {
    siteId = String(upserted.rows[0].id);
  }
}

async function resolvePostDomain() {
  const rows = await sql`
    SELECT "id"
    FROM tooty_data_domains
    WHERE "key" = 'post'
    LIMIT 1
  `;
  if (rows.rows[0]?.id) {
    dataDomainId = Number(rows.rows[0].id);
    return;
  }
  const fallback = await sql`
    SELECT "id"
    FROM tooty_data_domains
    WHERE "contentTable" = 'domain_posts'
    LIMIT 1
  `;
  if (fallback.rows[0]?.id) {
    dataDomainId = Number(fallback.rows[0].id);
    return;
  }
  try {
    const inserted = await sql`
      INSERT INTO tooty_data_domains ("key", "label", "contentTable", "metaTable", "createdAt", "updatedAt")
      VALUES ('post', 'Posts', 'domain_posts', 'domain_post_meta', NOW(), NOW())
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
      FROM tooty_data_domains
      WHERE "key" = 'post' OR "contentTable" = 'domain_posts'
      LIMIT 1
    `;
    dataDomainId = Number(retry.rows[0]?.id || 0);
  }
  if (!dataDomainId) throw new Error("Failed to resolve post data domain in test DB.");
}

async function createPost() {
  const content = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "E2E seeded post for network admin comment test." }] }],
  });
  const insert = await sql`
    INSERT INTO tooty_domain_posts
      ("id", "dataDomainId", "title", "description", "content", "slug", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${`${runId}-post`}, ${dataDomainId}, ${"Network Admin Comment Test Post"}, ${"Seeded by e2e"}, ${content}, ${postSlug}, true, ${siteId}, ${userId}, NOW(), NOW())
    RETURNING "id"
  `;
  postId = String(insert.rows[0]?.id || "");
  if (!postId) throw new Error("Failed to create seeded post.");
  await sql`
    INSERT INTO tooty_domain_post_meta ("domainPostId", "key", "value", "createdAt", "updatedAt")
    VALUES (${postId}, 'use_comments', 'true', NOW(), NOW())
    ON CONFLICT ("domainPostId", "key")
    DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;
}

async function ensureNetworkAdminUser() {
  await sql`
    INSERT INTO tooty_users ("id", "email", "name", "username", "role", "authProvider", "createdAt", "updatedAt")
    VALUES (${userId}, ${email}, ${realName}, ${username}, 'network admin', 'native', NOW(), NOW())
    ON CONFLICT ("id") DO UPDATE
    SET "email" = EXCLUDED."email",
        "name" = EXCLUDED."name",
        "username" = EXCLUDED."username",
        "role" = EXCLUDED."role",
        "authProvider" = EXCLUDED."authProvider",
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

async function ensureCommentSettings() {
  await setSettingByKey("setup_completed", "true");
  await setSettingByKey("plugin_tooty-comments_enabled", "true");
  await setSettingByKey(`site_${siteId}_plugin_tooty-comments_enabled`, "true");
  await setSettingByKey(`site_${siteId}_writing_enable_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_authenticated_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_allow_anonymous_comments`, "true");
  await setSettingByKey(`site_${siteId}_writing_comment_provider_tooty-comments_show_comments_to_public`, "true");
}

test.beforeAll(async () => {
  await ensureNetworkAdminUser();
  await resolveSite();
  await resolvePostDomain();
  await createPost();
  await ensureCommentSettings();
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

async function authenticateAs(
  page: import("@playwright/test").Page,
  uid: string,
  domain: string,
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

test("frontend post comment form uses network admin display_name and hides anonymous inputs", async ({ page }) => {
  await authenticateAs(page, userId, "app.localhost", {
    email,
    name: realName,
    username,
    displayName,
  });

  const bridgeStart = `${appOrigin}/theme-bridge-start?return=${encodeURIComponent(`${publicOrigin}/post/${postSlug}`)}`;
  await page.goto(bridgeStart);

  await ensureFrontendBridgeAuth(page);
  await expect(page.locator(".tooty-post-auth")).not.toContainText(realName, { timeout: 20000 });

  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
});
