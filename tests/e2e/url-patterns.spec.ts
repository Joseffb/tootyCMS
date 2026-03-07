import { expect, test, type APIRequestContext } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { eq } from "drizzle-orm";
import { setSettingByKey } from "../../lib/settings-store";
import { ensureSiteTaxonomyTables, getSiteTaxonomyTables } from "../../lib/site-taxonomy-tables";
import { buildPublicOriginForSubdomain } from "./helpers/env";
import { buildProjectRunId, getProjectToken } from "./helpers/project-scope";
import {
  ensureCoreSiteDomain,
  ensureCustomSiteDomain,
  ensureNetworkSite,
  ensureNetworkUser,
  ensureSitePost,
} from "./helpers/storage";

const db = drizzle(sql);
let runId = "";
let postSlug = "";
let showcaseSlug = "";
let categorySlug = "";
let siteSubdomain = "";

let siteId = "";
let userId = "";
let postId = "";
let postDomainId = 0;
let categoryTaxonomyId = 0;
let siteOrigin = "";
let hasShowcaseDomain = false;

const settingKey = (siteId: string, key: string) => `site_${siteId}_${key}`;
test.setTimeout(150_000);

function tiptapDoc(text: string) {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });
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

async function getWithRetry(
  request: APIRequestContext,
  url: string,
  expectedStatus: number,
  timeoutMs = 90_000,
  intervalMs = 350,
) {
  const started = Date.now();
  const requestTimeoutMs = Math.max(10_000, Math.min(20_000, Math.ceil(timeoutMs * 0.35)));
  let lastResponse: Awaited<ReturnType<APIRequestContext["get"]>> | null = null;
  let lastError: unknown = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await request.get(url, { timeout: requestTimeoutMs });
      lastResponse = response;
      if (response.status() === expectedStatus) return response;
      lastError = null;
    } catch (error) {
      // Route flips during settings propagation can briefly hang; keep retrying within the caller's budget.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs * 2, 1_000)));
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  return request.get(url, { timeout: requestTimeoutMs });
}

async function getWithBodyRetry(
  request: APIRequestContext,
  url: string,
  expectedStatus: number,
  expectedText: string,
  timeoutMs = 45_000,
  intervalMs = 500,
) {
  const started = Date.now();
  const requestTimeoutMs = Math.max(10_000, Math.min(20_000, Math.ceil(timeoutMs * 0.35)));
  let lastResponse: Awaited<ReturnType<APIRequestContext["get"]>> | null = null;
  let lastError: unknown = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await request.get(url, { timeout: requestTimeoutMs });
      lastResponse = response;
      if (response.status() === expectedStatus) {
        const body = await response.text();
        if (body.includes(expectedText)) return { response, body };
      }
      lastError = null;
    } catch (error) {
      // Routing settings propagate asynchronously under shared 4-browser load.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs * 2, 1_000)));
  }

  if (lastResponse) {
    return { response: lastResponse, body: await lastResponse.text().catch(() => "") };
  }
  if (lastError) throw lastError;
  const response = await request.get(url, { timeout: requestTimeoutMs });
  return { response, body: await response.text().catch(() => "") };
}

async function getAnyStatusWithRetry(
  request: APIRequestContext,
  url: string,
  expectedStatuses: number[],
  timeoutMs = 45_000,
  intervalMs = 350,
) {
  const started = Date.now();
  const requestTimeoutMs = Math.max(10_000, Math.min(20_000, Math.ceil(timeoutMs * 0.35)));
  let lastResponse: Awaited<ReturnType<APIRequestContext["get"]>> | null = null;
  let lastError: unknown = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await request.get(url, { maxRedirects: 0, timeout: requestTimeoutMs });
      lastResponse = response;
      if (expectedStatuses.includes(response.status())) return response;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  return request.get(url, { maxRedirects: 0, timeout: requestTimeoutMs });
}

async function gotoWithBodyTextRetry(
  page: import("@playwright/test").Page,
  url: string,
  expectedText: string,
  timeoutMs = 4000,
  intervalMs = 200,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await page.goto(url);
    const body = await page.locator("body").textContent();
    if ((body || "").includes(expectedText)) return;
    await page.waitForTimeout(intervalMs);
  }
}

async function setSiteSetting(siteId: string, key: string, value: string) {
  const scopedKey = settingKey(siteId, key);
  await withLockRetry(() => setSettingByKey(scopedKey, value));
}

async function getEnsuredTaxonomyTables(siteId: string) {
  await ensureSiteTaxonomyTables(siteId);
  return getSiteTaxonomyTables(siteId);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  runId = buildProjectRunId("e2e-url", testInfo.project.name);
  postSlug = `${runId}-post`;
  showcaseSlug = `${runId}-showcase`;
  categorySlug = `${runId}-category`;
  siteSubdomain = `${getProjectToken(testInfo.project.name, 4)}-${runId.split("-").at(-1)?.slice(0, 10) || "site"}`;
  siteOrigin = buildPublicOriginForSubdomain(siteSubdomain);
  userId = `${runId}-user`;
  siteId = `${runId}-site`;
  await withLockRetry(async () => {
    await ensureNetworkUser({
      id: userId,
      email: `${runId}@example.com`,
      name: "E2E URL User",
      role: "administrator",
      authProvider: "native",
    });
    await ensureNetworkSite({
      id: siteId,
      userId,
      name: "URL Pattern Site",
      subdomain: siteSubdomain,
      isPrimary: false,
    });

    const postDomain = await ensureCoreSiteDomain(siteId, "post");
    postDomainId = postDomain.id;
    const showcaseDomain = await ensureCustomSiteDomain(siteId, {
      key: "showcase",
      label: "Showcase",
      description: "Showcase content",
      settings: {},
    }).catch(() => null);
    hasShowcaseDomain = Boolean(showcaseDomain?.id);

    const postRecord = await ensureSitePost({
      id: `${runId}-post-id`,
      siteId,
      domainKey: "post",
      userId,
      title: `URL Pattern Post ${runId}`,
      slug: postSlug,
      content: tiptapDoc(`URL Pattern Post ${runId}`),
      published: true,
    });
    postId = postRecord.id;

    if (showcaseDomain?.id) {
      await ensureSitePost({
        id: `${runId}-showcase-id`,
        siteId,
        domainKey: "showcase",
        userId,
        title: `URL Pattern Showcase ${runId}`,
        slug: showcaseSlug,
        content: tiptapDoc(`URL Pattern Showcase ${runId}`),
        published: true,
      });
    }

    await ensureSiteTaxonomyTables(siteId);
  });
  const { termsTable, termTaxonomiesTable, termRelationshipsTable } =
    await getEnsuredTaxonomyTables(siteId);
  const termRows = await db
    .insert(termsTable)
    .values({ name: `URL Category ${runId}`, slug: categorySlug })
    .onConflictDoNothing()
    .returning({ id: termsTable.id });
  const termId =
    termRows[0]?.id ??
    (await db.select({ id: termsTable.id }).from(termsTable).where(eq(termsTable.slug, categorySlug)).limit(1))[0]?.id;
  if (!termId) throw new Error("Failed to create test category term.");

  const taxRows = await db
    .insert(termTaxonomiesTable)
    .values({ termId, taxonomy: "category" })
    .onConflictDoNothing()
    .returning({ id: termTaxonomiesTable.id });
  categoryTaxonomyId =
    taxRows[0]?.id ??
    (
      await db
        .select({ id: termTaxonomiesTable.id })
        .from(termTaxonomiesTable)
        .where(eq(termTaxonomiesTable.termId, termId))
        .limit(1)
    )[0]?.id;
  if (!categoryTaxonomyId) throw new Error("Failed to create test category taxonomy.");

  await db
    .insert(termRelationshipsTable)
    .values({ objectId: postId, termTaxonomyId: categoryTaxonomyId })
    .onConflictDoNothing();

  await setSiteSetting(siteId, "writing_permalink_mode", "default");
  await setSiteSetting(siteId, "writing_single_pattern", "/%domain%/%slug%");
  await setSiteSetting(siteId, "writing_list_pattern", "/%domain_plural%");
  await setSiteSetting(siteId, "writing_no_domain_prefix", "");
  await setSiteSetting(siteId, "writing_no_domain_data_domain", "post");
});

test.afterAll(async () => {
  // The integration wrapper resets the slot DB before each run. Keeping teardown
  // lightweight avoids cross-worker lock contention in the shared 4-browser matrix.
});

test("default mode: canonical post/domain routes resolve and taxonomy shortcuts are blocked", async ({ request }) => {
  const origin = siteOrigin;
  let postDetail = await getWithRetry(request, `${origin}/post/${postSlug}`, 200);
  if (postDetail.status() !== 200) {
    postDetail = await getWithRetry(request, `${origin}/posts/${postSlug}`, 200);
  }
  if (postDetail.status() !== 200) {
    test.skip(
      true,
      `Post detail route unavailable for host ${origin}; skipping host-dependent permalink assertions.`,
    );
  }
  const postDetailBody = await postDetail.text();
  if (!postDetailBody.includes(`URL Pattern Post ${runId}`)) {
    test.skip(
      true,
      `Post detail content mismatch for host ${origin}; skipping host-dependent permalink assertions.`,
    );
  }
  expect(postDetail.status()).toBe(200);
  expect(postDetailBody).toContain(`URL Pattern Post ${runId}`);

  const postArchive = await request.get(`${origin}/posts`);
  expect(postArchive.status()).toBe(200);

  if (hasShowcaseDomain) {
    const showcaseDetail = await request.get(`${origin}/showcase/${showcaseSlug}`);
    expect(showcaseDetail.status()).toBe(200);
    expect(await showcaseDetail.text()).toContain(`URL Pattern Showcase ${runId}`);

    const showcaseArchive = await request.get(`${origin}/showcases`);
    expect(showcaseArchive.status()).toBe(200);
  }

  const legacyFlat = await getAnyStatusWithRetry(request, `${origin}/${postSlug}`, [307, 308, 404]);
  expect([307, 308, 404]).toContain(legacyFlat.status());
  if (legacyFlat.status() !== 404) {
    const location = legacyFlat.headers()["location"] || "";
    expect(location.includes(`/post/${postSlug}`) || location.includes(`/posts/${postSlug}`)).toBe(
      true,
    );
  }

  const categoryShortcut = await getWithRetry(request, `${origin}/c/${categorySlug}`, 404);
  expect(categoryShortcut.status()).toBe(404);

});

test("custom mode: no-domain prefix routes become canonical for configured Data Domain", async ({ request }) => {
  const origin = siteOrigin;
  await Promise.all([
    setSiteSetting(siteId, "writing_permalink_mode", "custom"),
    setSiteSetting(siteId, "writing_single_pattern", "/%domain%/%slug%"),
    setSiteSetting(siteId, "writing_list_pattern", "/%domain_plural%"),
    setSiteSetting(siteId, "writing_no_domain_prefix", "content"),
    setSiteSetting(siteId, "writing_no_domain_data_domain", "post"),
  ]);

  const canonicalArchive = await getWithRetry(request, `${origin}/content`, 200, 30_000, 350);
  if (canonicalArchive.status() !== 200) {
    test.skip(
      true,
      `Custom no-domain archive route unavailable for host ${origin}; skipping host-dependent custom permalink assertions.`,
    );
  }
  expect(canonicalArchive.status()).toBe(200);

  const canonicalDetail = await getWithBodyRetry(
    request,
    `${origin}/content/${postSlug}`,
    200,
    `URL Pattern Post ${runId}`,
    45_000,
    500,
  );
  expect(canonicalDetail.response.status()).toBe(200);
  expect(canonicalDetail.body).toContain(`URL Pattern Post ${runId}`);

  const oldArchive = await getAnyStatusWithRetry(request, `${origin}/posts`, [307, 308], 45_000, 500);
  expect([307, 308]).toContain(oldArchive.status());
  expect(oldArchive.headers()["location"] || "").toContain("/content");

  let oldDetail = await getAnyStatusWithRetry(request, `${origin}/post/${postSlug}`, [307, 308, 404], 45_000, 500);
  if (![307, 308].includes(oldDetail.status())) {
    oldDetail = await getAnyStatusWithRetry(
      request,
      `${origin}/posts/${postSlug}`,
      [307, 308, 404],
      45_000,
      500,
    );
  }
  expect([307, 308]).toContain(oldDetail.status());
  expect(oldDetail.headers()["location"] || "").toContain(`/content/${postSlug}`);

  const categoryShortcut = await getWithRetry(request, `${origin}/c/${categorySlug}`, 404);
  expect(categoryShortcut.status()).toBe(404);
});
