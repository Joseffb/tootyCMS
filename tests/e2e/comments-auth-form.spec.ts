import { expect, test, type Page } from "@playwright/test";
import { sql } from "@vercel/postgres";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";

const runId = `e2e-comments-auth-${Date.now()}`;
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
const mainHost = "main.localhost";

let siteId = "";
let postId = domainPostId;
let dataDomainId = 0;

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
    INSERT INTO tooty_user_meta ("userId", "key", "value", "createdAt", "updatedAt")
    VALUES (${userId}, 'display_name', ${userDisplayName}, NOW(), NOW())
    ON CONFLICT ("userId", "key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "updatedAt" = NOW()
  `;
}

async function ensurePost() {
  const content = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Comments auth test." }] }],
  });
  const inserted = await sql`
    INSERT INTO tooty_domain_posts
      ("id", "dataDomainId", "title", "description", "content", "slug", "published", "siteId", "userId", "createdAt", "updatedAt")
    VALUES
      (${postId}, ${dataDomainId}, ${"Comments Auth Test"}, ${"Auth mode test"}, ${content}, ${postSlug}, true, ${siteId}, ${userId}, NOW(), NOW())
    RETURNING "id"
  `;
  postId = String(inserted.rows[0].id);
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

test("comments form shows anonymous identity inputs when logged out", async ({ page }) => {
  await page.goto(`http://${mainHost}:3000/post/${postSlug}`);
  await expect(page.locator(".tooty-comments-title")).toBeVisible();
  await expect(page.locator(".tooty-post-auth")).toHaveText("", { timeout: 20000 });
  await expect(page.locator("[data-comments-list]")).not.toContainText("Loading comments...", { timeout: 20000 });
  await expect(page.locator(".tooty-comments-note")).toContainText(/Guests can post comments/i, { timeout: 20000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeVisible();
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeVisible();
});

test("comments form hides anonymous identity inputs when logged in", async ({ page }) => {
  await authenticateAs(page, userId, mainHost);
  const commentsResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/comments?") && response.request().method() === "GET",
    { timeout: 20000 },
  );
  await page.goto(`http://${mainHost}:3000/post/${postSlug}`);
  await expect(page.locator(".tooty-comments-title")).toBeVisible();
  await expect(page.locator(".tooty-post-auth")).toContainText(`Hello ${userDisplayName}`, { timeout: 20000 });
  const commentsResponse = await commentsResponsePromise;
  expect(commentsResponse.ok()).toBeTruthy();
  const commentsPayload = await commentsResponse.json();
  expect(Boolean(commentsPayload?.permissions?.canPostAsUser)).toBe(true);
  await expect(page.locator("[data-comments-list]")).not.toContainText("Loading comments...", { timeout: 20000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
  await page.locator("[data-comments-form] textarea[name='body']").fill("Signed-in display name check");
  await page.locator("[data-comments-form] button[type='submit']").click();
  await expect(page.locator("[data-comments-list]")).toContainText("Signed-in display name check", { timeout: 20000 });
  await expect(page.locator("[data-comments-list]")).toContainText(userDisplayName, { timeout: 20000 });
  await expect(page.locator("[data-comments-list]")).not.toContainText(userName);
});

test("authenticated session without DB user row still posts without anonymous identity fields", async ({ page }) => {
  await authenticateAs(page, ghostUserId, mainHost, {
    email: ghostUserEmail,
    name: ghostUserName,
    username: ghostUserUsername,
    displayName: ghostUserDisplayName,
  });
  const commentsResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/comments?") && response.request().method() === "GET",
    { timeout: 20000 },
  );
  await page.goto(`http://${mainHost}:3000/post/${postSlug}`);
  await expect(page.locator(".tooty-comments-title")).toBeVisible();
  await expect(page.locator(".tooty-post-auth")).toContainText(`Hello ${ghostUserDisplayName}`, { timeout: 20000 });
  const commentsResponse = await commentsResponsePromise;
  expect(commentsResponse.ok()).toBeTruthy();
  const commentsPayload = await commentsResponse.json();
  expect(Boolean(commentsPayload?.permissions?.isAuthenticated)).toBe(true);
  expect(Boolean(commentsPayload?.permissions?.canPostAsUser)).toBe(false);
  await expect(page.locator("[data-comments-list]")).not.toContainText("Loading comments...", { timeout: 20000 });
  await expect(page.locator("label:has-text('Display Name')")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("label:has-text('Email (never shown)')")).toBeHidden({ timeout: 20000 });
  await page.locator("[data-comments-form] textarea[name='body']").fill("Ghost session fallback comment");
  await page.locator("[data-comments-form] button[type='submit']").click();
  await expect(page.locator("[data-comments-list]")).toContainText("Ghost session fallback comment", { timeout: 20000 });
  await expect(page.locator("[data-comments-list]")).toContainText(ghostUserDisplayName, { timeout: 20000 });
});

test("anonymous email is stored but never leaked in API or DOM", async ({ page }) => {
  const anonEmail = `${runId}-anon@example.com`;
  const createResponse = await page.request.post("http://localhost:3000/api/comments", {
    data: {
      siteId,
      contextType: "entry",
      contextId: postId,
      body: "Anonymous no-leak comment",
      authorName: "Anon Poster",
      authorEmail: anonEmail,
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();
  expect(String(created?.item?.metadata?.author_email || "")).toBe("");

  const listResponse = await page.request.get(
    `http://localhost:3000/api/comments?siteId=${siteId}&contextType=entry&contextId=${postId}&limit=100&offset=0`,
  );
  expect(listResponse.ok()).toBeTruthy();
  const listed = await listResponse.json();
  const flattened = JSON.stringify(listed || {});
  expect(flattened).not.toContain(anonEmail);

  await page.goto(`http://${mainHost}:3000/post/${postSlug}`);
  await expect(page.locator("body")).not.toContainText(anonEmail);
});

test("theme page remains responsive and does not spam auth session calls", async ({ page }) => {
  let authSessionRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/session")) {
      authSessionRequests += 1;
    }
  });

  await page.goto(`http://${mainHost}:3000/post/${postSlug}`);
  await expect(page.locator(".tooty-comments-title")).toBeVisible();
  await expect(page.locator("[data-comments-list]")).not.toContainText("Loading comments...", { timeout: 20000 });

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
