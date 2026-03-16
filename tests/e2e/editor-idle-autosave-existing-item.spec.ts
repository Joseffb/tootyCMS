import { expect, test, type Page } from "@playwright/test";
import db from "../../lib/db";
import { encode } from "next-auth/jwt";
import { and, eq } from "drizzle-orm";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteTaxonomyTables, getSiteTaxonomyTables } from "../../lib/site-taxonomy-tables";
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
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(url);
      return;
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

async function ensureSitePostTaxonomyAssignment(input: {
  siteId: string;
  postId: string;
  taxonomy: "category" | "tag";
  name: string;
  slug: string;
}) {
  await withDeadlockRetry(() => ensureSiteTaxonomyTables(input.siteId));
  const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(input.siteId);

  const [existingTermTaxonomy] = await db
    .select({ id: termTaxonomiesTable.id })
    .from(termTaxonomiesTable)
    .innerJoin(termsTable, eq(termTaxonomiesTable.termId, termsTable.id))
    .where(and(eq(termTaxonomiesTable.taxonomy, input.taxonomy), eq(termsTable.slug, input.slug)))
    .limit(1);

  let termTaxonomyId = existingTermTaxonomy?.id ?? null;
  if (!termTaxonomyId) {
    const [insertedTerm] = await db
      .insert(termsTable)
      .values({ name: input.name, slug: input.slug })
      .onConflictDoNothing()
      .returning({ id: termsTable.id });

    const termId =
      insertedTerm?.id ??
      (await db.select({ id: termsTable.id }).from(termsTable).where(eq(termsTable.slug, input.slug)).limit(1))[0]?.id;
    if (!termId) {
      throw new Error(`Failed to resolve ${input.taxonomy} term ${input.slug}.`);
    }

    const [insertedTermTaxonomy] = await db
      .insert(termTaxonomiesTable)
      .values({ termId, taxonomy: input.taxonomy })
      .onConflictDoNothing()
      .returning({ id: termTaxonomiesTable.id });

    termTaxonomyId =
      insertedTermTaxonomy?.id ??
      (
        await db
          .select({ id: termTaxonomiesTable.id })
          .from(termTaxonomiesTable)
          .where(and(eq(termTaxonomiesTable.termId, termId), eq(termTaxonomiesTable.taxonomy, input.taxonomy)))
          .limit(1)
      )[0]?.id ??
      null;
  }

  if (!termTaxonomyId) {
    throw new Error(`Failed to resolve ${input.taxonomy} taxonomy row ${input.slug}.`);
  }

  await db
    .insert(termRelationshipsTable)
    .values({ objectId: input.postId, termTaxonomyId })
    .onConflictDoNothing();
}

async function provisionExistingItemFixture(projectName: string) {
  const runId = buildProjectRunId("e2e-editor-idle-existing-item", projectName);
  const userId = `${runId}-user`;
  const email = `${runId}@example.com`;
  const siteId = `${runId}-site`;
  const postId = `${runId}-post`;
  const subdomain = `${runId}-site`.slice(0, 40);

  await withDeadlockRetry(() => setSettingByKey("setup_completed", "true"));
  await withDeadlockRetry(() =>
    ensureNetworkUser({
      id: userId,
      email,
      name: "Editor Idle Existing Item User",
      role: "administrator",
    }),
  );
  await withDeadlockRetry(() =>
    ensureNetworkSite({
      id: siteId,
      userId,
      name: "Editor Idle Existing Item Site",
      subdomain,
      isPrimary: false,
    }),
  );
  await withDeadlockRetry(() => upsertSiteUserRole(siteId, userId, "administrator"));
  await withDeadlockRetry(() => ensureCoreSiteDomain(siteId, "post"));
  await withDeadlockRetry(() =>
    ensureSitePost({
      siteId,
      domainKey: "post",
      id: postId,
      userId,
      slug: `${runId}-article`,
      title: "Editor Idle Existing Item",
      description: "Persisted editor item for idle autosave verification.",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Persisted item body" }],
          },
        ],
      }),
      published: false,
    }),
  );
  await ensureSitePostTaxonomyAssignment({
    siteId,
    postId,
    taxonomy: "category",
    name: `Idle Category ${runId}`,
    slug: `${runId}-category`,
  });
  await ensureSitePostTaxonomyAssignment({
    siteId,
    postId,
    taxonomy: "tag",
    name: `Idle Tag ${runId}`,
    slug: `${runId}-tag`,
  });

  return {
    email,
    postId,
    siteId,
    userId,
    autosavePath: `/api/editor/domain-posts/${postId}/autosave`,
    url: `${appOrigin}/app/cp/site/${siteId}/domain/post/item/${postId}`,
  };
}

test.skip(
  !(process.env.POSTGRES_URL || process.env.POSTGRES_TEST_URL),
  "POSTGRES_URL or POSTGRES_TEST_URL is required for editor idle autosave existing-item e2e.",
);

test("existing persisted item page stays idle without autosave posts", async ({ page }, testInfo) => {
  test.slow();
  testInfo.setTimeout(120_000);

  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for editor idle autosave existing-item e2e.");

  const fixture = await provisionExistingItemFixture(testInfo.project.name);

  const token = await encode({
    secret,
    token: {
      sub: fixture.userId,
      email: fixture.email,
      name: "Editor Idle Existing Item User",
      role: "administrator",
      user: {
        id: fixture.userId,
        email: fixture.email,
        name: "Editor Idle Existing Item User",
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
      request.url().includes(`/app/cp/site/${fixture.siteId}/domain/post/item/${fixture.postId}`) ||
      request.url().includes(fixture.autosavePath)
    ) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });

  const url = fixture.url;
  await gotoEditorItemPage(page, url);

  await page.waitForTimeout(12_000);

  const itemPosts = requests.filter((request) => request.method === "POST");
  const autosavePosts = requests.filter(
    (request) => request.method === "POST" && request.url.includes(fixture.autosavePath),
  );
  const debugEvents = await page.evaluate(
    () => (window as Window & { __TOOTY_EDITOR_DEBUG__?: unknown[] }).__TOOTY_EDITOR_DEBUG__ ?? [],
  );

  expect(
    { itemPosts, autosavePosts, debugTail: debugEvents.slice(-20) },
    "existing persisted item page should stay idle without page or autosave API POSTs",
  ).toEqual({
    itemPosts: [],
    autosavePosts: [],
    debugTail: expect.any(Array),
  });
});

test("existing persisted item page does not background-refetch seeded category and tag references when More opens", async ({
  page,
}, testInfo) => {
  test.slow();
  testInfo.setTimeout(120_000);

  const secret = String(process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for editor idle autosave existing-item e2e.");

  const fixture = await provisionExistingItemFixture(`${testInfo.project.name}-reference`);

  const token = await encode({
    secret,
    token: {
      sub: fixture.userId,
      email: fixture.email,
      name: "Editor Idle Existing Item Reference User",
      role: "administrator",
      user: {
        id: fixture.userId,
        email: fixture.email,
        name: "Editor Idle Existing Item Reference User",
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

  await page.addInitScript(({ postId }) => {
    window.sessionStorage.setItem("tooty.editor.runtime.version", "2026-03-13.3");
    window.sessionStorage.setItem(`tooty.editor.sidebar-tab.v1:${postId}`, "plugins");
  }, { postId: fixture.postId });

  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/editor/reference?") &&
      request.url().includes(`siteId=${fixture.siteId}`) &&
      (request.url().includes("taxonomy=category") || request.url().includes("taxonomy=tag"))
    ) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });

  const url = fixture.url;
  await gotoEditorItemPage(page, url);

  await page.getByRole("tab", { name: "More", exact: true }).click();
  await page.waitForTimeout(8_000);

  const categoryAndTagReferenceGets = requests.filter((request) => request.method === "GET");
  const debugEvents = await page.evaluate(
    () => (window as Window & { __TOOTY_EDITOR_DEBUG__?: unknown[] }).__TOOTY_EDITOR_DEBUG__ ?? [],
  );

  expect(
    { categoryAndTagReferenceGets, debugTail: debugEvents.slice(-20) },
    "existing persisted item page should use server-seeded category/tag references instead of background-refetching them when More opens",
  ).toEqual({
    categoryAndTagReferenceGets: [],
    debugTail: expect.any(Array),
  });
});
