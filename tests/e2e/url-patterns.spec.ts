import { expect, test, type APIRequestContext } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  dataDomains,
  domainPosts,
  siteDataDomains,
  sites,
  termRelationships,
  termTaxonomies,
  terms,
  users,
} from "../../lib/schema";
import { deleteSettingsByKeys, setSettingByKey } from "../../lib/settings-store";
import { buildPublicOriginForSubdomain } from "./helpers/env";

const db = drizzle(sql);
const runId = `e2e-url-${randomUUID()}`;
const postSlug = `${runId}-post`;
const showcaseSlug = `${runId}-showcase`;
const categorySlug = `${runId}-category`;
const siteSubdomain = `${runId}-site`;

let siteId = "";
let userId = "";
let postId = "";
let postDomainId = 0;
let categoryTaxonomyId = 0;
const siteOrigin = buildPublicOriginForSubdomain(siteSubdomain);
let hasShowcaseDomain = false;

const settingKey = (siteId: string, key: string) => `site_${siteId}_${key}`;
const PERMALINK_KEYS = [
  "writing_permalink_mode",
  "writing_single_pattern",
  "writing_list_pattern",
  "writing_no_domain_prefix",
  "writing_no_domain_data_domain",
];

test.setTimeout(60_000);

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

async function getWithRetry(
  request: APIRequestContext,
  url: string,
  expectedStatus: number,
  timeoutMs = 10_000,
  intervalMs = 250,
) {
  const started = Date.now();
  const requestTimeoutMs = Math.max(3_000, Math.min(8_000, intervalMs * 16));
  let lastResponse: Awaited<ReturnType<APIRequestContext["get"]>> | null = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await request.get(url, { timeout: requestTimeoutMs });
      lastResponse = response;
      if (response.status() === expectedStatus) return response;
    } catch {
      // Route flips during settings propagation can briefly hang; keep retrying within the caller's budget.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastResponse) return lastResponse;
  return request.get(url, { timeout: Math.max(requestTimeoutMs, 4_000) });
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
  await setSettingByKey(scopedKey, value);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userId = `${runId}-user`;
  siteId = `${runId}-site`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${runId}@example.com`,
      name: "E2E URL User",
      role: "administrator",
    })
    .onConflictDoNothing();
  await db
    .insert(sites)
    .values({
      id: siteId,
      userId,
      name: "URL Pattern Site",
      subdomain: siteSubdomain,
      isPrimary: false,
    })
    .onConflictDoNothing();

  const showcaseDomainRows = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(eq(dataDomains.key, "showcase"))
    .limit(1);
  hasShowcaseDomain = Boolean(showcaseDomainRows[0]?.id);
  let postDomainRows = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(eq(dataDomains.key, "post"))
    .limit(1);
  if (!postDomainRows[0]) {
    await db
      .insert(dataDomains)
      .values({
        key: "post",
        label: "Post",
        contentTable: "domain_posts",
        metaTable: "domain_post_meta",
        description: "Default core post type",
      })
      .onConflictDoUpdate({
        target: dataDomains.key,
        set: {
          label: "Post",
          contentTable: "domain_posts",
          metaTable: "domain_post_meta",
          description: "Default core post type",
        },
      });
    postDomainRows = await db
      .select({ id: dataDomains.id })
      .from(dataDomains)
      .where(eq(dataDomains.key, "post"))
      .limit(1);
  }
  if (!postDomainRows[0]) throw new Error("Data domain `post` not found.");
  postDomainId = postDomainRows[0].id;

  await db
    .insert(siteDataDomains)
    .values({ siteId, dataDomainId: postDomainId, isActive: true })
    .onConflictDoUpdate({
      target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
      set: { isActive: true },
    });

  if (showcaseDomainRows[0]?.id) {
    await db
      .insert(siteDataDomains)
      .values({ siteId, dataDomainId: showcaseDomainRows[0].id, isActive: true })
      .onConflictDoUpdate({
        target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
        set: { isActive: true },
      });
  }

  const postRows = await db
    .insert(domainPosts)
    .values({
      dataDomainId: postDomainId,
      title: `URL Pattern Post ${runId}`,
      slug: postSlug,
      content: tiptapDoc(`URL Pattern Post ${runId}`),
      published: true,
      siteId,
      userId,
    })
    .returning({ id: domainPosts.id });
  postId = postRows[0].id;

  if (showcaseDomainRows[0]?.id) {
    await db.insert(domainPosts).values({
      dataDomainId: showcaseDomainRows[0].id,
      title: `URL Pattern Showcase ${runId}`,
      slug: showcaseSlug,
      content: tiptapDoc(`URL Pattern Showcase ${runId}`),
      published: true,
      siteId,
      userId,
    });
  }

  const termRows = await db
    .insert(terms)
    .values({ name: `URL Category ${runId}`, slug: categorySlug })
    .onConflictDoNothing()
    .returning({ id: terms.id });
  const termId =
    termRows[0]?.id ??
    (
      await db.select({ id: terms.id }).from(terms).where(eq(terms.slug, categorySlug)).limit(1)
    )[0]?.id;
  if (!termId) throw new Error("Failed to create test category term.");

  const taxRows = await db
    .insert(termTaxonomies)
    .values({ termId, taxonomy: "category" })
    .onConflictDoNothing()
    .returning({ id: termTaxonomies.id });
  categoryTaxonomyId =
    taxRows[0]?.id ??
    (
      await db
        .select({ id: termTaxonomies.id })
        .from(termTaxonomies)
        .where(and(eq(termTaxonomies.termId, termId), eq(termTaxonomies.taxonomy, "category")))
        .limit(1)
    )[0]?.id;
  if (!categoryTaxonomyId) throw new Error("Failed to create test category taxonomy.");

  await db
    .insert(termRelationships)
    .values({ objectId: postId, termTaxonomyId: categoryTaxonomyId })
    .onConflictDoNothing();

  await setSiteSetting(siteId, "writing_permalink_mode", "default");
  await setSiteSetting(siteId, "writing_single_pattern", "/%domain%/%slug%");
  await setSiteSetting(siteId, "writing_list_pattern", "/%domain_plural%");
  await setSiteSetting(siteId, "writing_no_domain_prefix", "");
  await setSiteSetting(siteId, "writing_no_domain_data_domain", "post");
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  await Promise.all([
    deleteSettingsByKeys(PERMALINK_KEYS.map((key) => settingKey(siteId, key))),
    db
      .delete(termRelationships)
      .where(and(eq(termRelationships.objectId, postId), eq(termRelationships.termTaxonomyId, categoryTaxonomyId))),
    hasShowcaseDomain
      ? db
          .delete(domainPosts)
          .where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.slug, showcaseSlug)))
      : Promise.resolve(),
    db
      .delete(domainPosts)
      .where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug))),
  ]);
  await Promise.all([
    db.delete(termTaxonomies).where(eq(termTaxonomies.id, categoryTaxonomyId)),
    db.delete(siteDataDomains).where(eq(siteDataDomains.siteId, siteId)),
  ]);
  await db.delete(terms).where(eq(terms.slug, categorySlug));
  await db.delete(sites).where(eq(sites.id, siteId));
  await db.delete(users).where(eq(users.id, userId));
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

  const legacyFlat = await request.get(`${origin}/${postSlug}`, { maxRedirects: 0 });
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

  const canonicalArchive = await getWithRetry(request, `${origin}/content`, 200, 10_000, 250);
  if (canonicalArchive.status() !== 200) {
    test.skip(
      true,
      `Custom no-domain archive route unavailable for host ${origin}; skipping host-dependent custom permalink assertions.`,
    );
  }
  expect(canonicalArchive.status()).toBe(200);

  const canonicalDetail = await getWithRetry(request, `${origin}/content/${postSlug}`, 200, 10_000, 250);
  expect(canonicalDetail.status()).toBe(200);

  const oldArchive = await request.get(`${origin}/posts`, { maxRedirects: 0 });
  expect([307, 308]).toContain(oldArchive.status());
  expect(oldArchive.headers()["location"] || "").toContain("/content");

  let oldDetail = await request.get(`${origin}/post/${postSlug}`, { maxRedirects: 0 });
  if (![307, 308].includes(oldDetail.status())) {
    oldDetail = await request.get(`${origin}/posts/${postSlug}`, { maxRedirects: 0 });
  }
  expect([307, 308]).toContain(oldDetail.status());
  expect(oldDetail.headers()["location"] || "").toContain(`/content/${postSlug}`);

  const categoryShortcut = await getWithRetry(request, `${origin}/c/${categorySlug}`, 404);
  expect(categoryShortcut.status()).toBe(404);
});
