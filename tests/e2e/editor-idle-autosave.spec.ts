import { expect, test, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteDomainTypeTables } from "../../lib/site-domain-type-tables";
import { upsertSiteUserRole } from "../../lib/site-user-tables";
import { addSessionTokenCookie } from "./helpers/auth";
import { getAppHostname, getAppOrigin } from "./helpers/env";
import { buildProjectRunId } from "./helpers/project-scope";
import {
  ensureCoreSiteDomain,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureSitePost,
} from "./helpers/storage";

const appOrigin = getAppOrigin();
const appHostname = getAppHostname();

async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code || "")
          : "";
      if (code !== "40P01" && code !== "55P03") {
        throw error;
      }
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

async function gotoEditorItemPage(page: Page, url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(url);
      const appErrorVisible = await page
        .getByText(/Application error: a server-side exception has occurred while loading/i)
        .isVisible()
        .catch(() => false);
      if (appErrorVisible) {
        await page.waitForTimeout(1_000);
        continue;
      }
      const titleVisible = await page.getByPlaceholder("Title").isVisible().catch(() => false);
      const saveStatusVisible = await page
        .locator("[data-editor-save-status]")
        .first()
        .isVisible()
        .catch(() => false);
      if (titleVisible || saveStatusVisible) {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes("Could not connect to the server") &&
        !message.includes("net::ERR_CONNECTION_REFUSED") &&
        !message.includes("NS_ERROR_CONNECTION_REFUSED")
      ) {
        throw error;
      }
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Timed out waiting for editor item page ${url}.`);
}

async function waitForEditorSaved(page: Page, timeoutMs = 90_000) {
  await expect
    .poll(
      async () => {
        const status = await page
          .locator("[data-editor-save-status]")
          .first()
          .getAttribute("data-editor-save-status")
          .catch(() => null);
        return status || "missing";
      },
      {
        timeout: timeoutMs,
        message: "Expected editor save status to settle to saved.",
      },
    )
    .toBe("saved");
}

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for editor idle autosave e2e.",
);

test("persisted item page stays idle without autosave posts", async ({ page }, testInfo) => {
  test.slow();
  testInfo.setTimeout(120_000);

  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for editor idle autosave e2e.");

  const runId = buildProjectRunId("e2e-editor-idle-autosave", testInfo.project.name);
  const userId = `${runId}-user`;
  const siteId = `${runId}-site`;
  const postId = `${runId}-post`;
  const email = `${runId}@example.com`;

  await withDeadlockRetry(() => setSettingByKey("setup_completed", "true"));
  await withDeadlockRetry(() =>
    ensureNetworkUser({
      id: userId,
      email,
      name: "Editor Idle Autosave User",
      role: "administrator",
    }),
  );
  await withDeadlockRetry(() =>
    ensureNetworkSite({
      id: siteId,
      userId,
      name: "Editor Idle Autosave Site",
      subdomain: `${runId}-site`,
      isPrimary: true,
    }),
  );
  await withDeadlockRetry(() => upsertSiteUserRole(siteId, userId, "administrator"));
  await withDeadlockRetry(() => ensureCoreSiteDomain(siteId, "post"));
  await withDeadlockRetry(() => ensureSiteDomainTypeTables(siteId, "post"));
  await withDeadlockRetry(() =>
    ensureSitePost({
      siteId,
      domainKey: "post",
      id: postId,
      userId,
      slug: `idle-autosave-${runId}`,
      title: "Idle Autosave Regression Post",
      description: "This item should not autosave when left idle.",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Idle autosave body." }] }],
      }),
      published: false,
    }),
  );

  const token = await encode({
    secret,
    token: {
      sub: userId,
      email,
      name: "Editor Idle Autosave User",
      role: "administrator",
      user: {
        id: userId,
        email,
        name: "Editor Idle Autosave User",
        role: "administrator",
      },
    },
    maxAge: 60 * 60,
  });

  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    domain: appHostname,
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
  });

  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (
      request.url().includes(`/app/cp/site/${siteId}/domain/post/item/${postId}`) ||
      request.url().includes(`/api/editor/domain-posts/${postId}/autosave`)
    ) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });

  const url = `${appOrigin}/app/cp/site/${siteId}/domain/post/item/${postId}`;
  await gotoEditorItemPage(page, url);

  await page.waitForTimeout(12_000);

  const itemPosts = requests.filter((request) => request.method === "POST");
  const autosavePosts = requests.filter(
    (request) => request.method === "POST" && request.url.includes(`/api/editor/domain-posts/${postId}/autosave`),
  );
  const debugEvents = await page.evaluate(() => (window as Window & { __TOOTY_EDITOR_DEBUG__?: unknown[] }).__TOOTY_EDITOR_DEBUG__ ?? []);

  expect(
    { itemPosts, autosavePosts, debugTail: debugEvents.slice(-20) },
    "persisted item page should stay idle without page or autosave API POSTs",
  ).toEqual({
    itemPosts: [],
    autosavePosts: [],
    debugTail: expect.any(Array),
  });
});

test("persisted item page settles after one explicit save instead of re-arming idle autosave", async ({ page }, testInfo) => {
  test.slow();
  testInfo.setTimeout(120_000);

  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for editor idle autosave e2e.");

  const runId = buildProjectRunId("e2e-editor-idle-settle", testInfo.project.name);
  const userId = `${runId}-user`;
  const siteId = `${runId}-site`;
  const postId = `${runId}-post`;
  const email = `${runId}@example.com`;

  await withDeadlockRetry(() => setSettingByKey("setup_completed", "true"));
  await withDeadlockRetry(() =>
    ensureNetworkUser({
      id: userId,
      email,
      name: "Editor Idle Settle User",
      role: "administrator",
    }),
  );
  await withDeadlockRetry(() =>
    ensureNetworkSite({
      id: siteId,
      userId,
      name: "Editor Idle Settle Site",
      subdomain: `${runId}-site`,
      isPrimary: true,
    }),
  );
  await withDeadlockRetry(() => upsertSiteUserRole(siteId, userId, "administrator"));
  await withDeadlockRetry(() => ensureCoreSiteDomain(siteId, "post"));
  await withDeadlockRetry(() => ensureSiteDomainTypeTables(siteId, "post"));
  await withDeadlockRetry(() =>
    ensureSitePost({
      siteId,
      domainKey: "post",
      id: postId,
      userId,
      slug: `idle-settle-${runId}`,
      title: "Idle Settle Regression Post",
      description: "This item should settle after one explicit save.",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Idle settle body." }] }],
      }),
      published: false,
    }),
  );

  const token = await encode({
    secret,
    token: {
      sub: userId,
      email,
      name: "Editor Idle Settle User",
      role: "administrator",
      user: {
        id: userId,
        email,
        name: "Editor Idle Settle User",
        role: "administrator",
      },
    },
    maxAge: 60 * 60,
  });

  await addSessionTokenCookie(page.context(), {
    value: token,
    origin: appOrigin,
    domain: appHostname,
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
  });

  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (
      request.url().includes(`/app/cp/site/${siteId}/domain/post/item/${postId}`) ||
      request.url().includes(`/api/editor/domain-posts/${postId}/autosave`)
    ) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });

  const url = `${appOrigin}/app/cp/site/${siteId}/domain/post/item/${postId}`;
  await gotoEditorItemPage(page, url);

  const titleField = page.getByPlaceholder("Title");
  await titleField.click();
  await titleField.fill("Idle Settle Regression Post Updated");
  await waitForEditorSaved(page);

  requests.length = 0;
  await page.waitForTimeout(8_000);

  const itemPosts = requests.filter((request) => request.method === "POST");
  const autosavePosts = requests.filter(
    (request) => request.method === "POST" && request.url.includes(`/api/editor/domain-posts/${postId}/autosave`),
  );
  const debugEvents = await page.evaluate(() => (window as Window & { __TOOTY_EDITOR_DEBUG__?: unknown[] }).__TOOTY_EDITOR_DEBUG__ ?? []);

  expect(
    { itemPosts, autosavePosts, debugTail: debugEvents.slice(-20) },
    "persisted item page should not enqueue idle autosaves after a successful save settles",
  ).toEqual({
    itemPosts: [],
    autosavePosts: [],
    debugTail: expect.any(Array),
  });
});
