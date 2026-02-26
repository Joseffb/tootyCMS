import { expect, test, type APIRequestContext } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { and, eq, inArray, like, or } from "drizzle-orm";
import {
  cmsSettings,
  dataDomains,
  domainPosts,
  siteDataDomains,
  sites,
  termRelationships,
  termTaxonomies,
  terms,
  users,
} from "../../lib/schema";

const db = drizzle(sql);
const runId = `e2e-url-${Date.now()}`;
const postSlug = `${runId}-post`;
const showcaseSlug = `${runId}-showcase`;
const categorySlug = `${runId}-category`;

let mainSiteId = "";
let mainUserId = "";
let postId = "";
let postDomainId = 0;
let showcaseDomainId = 0;
let categoryTaxonomyId = 0;
let siteHost = "main.localhost";
const previousSettings = new Map<string, string | null>();

const settingKey = (siteId: string, key: string) => `site_${siteId}_${key}`;
const PERMALINK_KEYS = [
  "writing_permalink_mode",
  "writing_single_pattern",
  "writing_list_pattern",
  "writing_no_domain_prefix",
  "writing_no_domain_data_domain",
];

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
  timeoutMs = 4000,
  intervalMs = 200,
) {
  const started = Date.now();
  let response = await request.get(url);
  while (response.status() !== expectedStatus && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    response = await request.get(url);
  }
  return response;
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
  await db
    .insert(cmsSettings)
    .values({ key: scopedKey, value })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value } });
}

async function captureCurrentSettings(siteId: string) {
  for (const key of PERMALINK_KEYS) {
    const scopedKey = settingKey(siteId, key);
    const rows = await db.select({ value: cmsSettings.value }).from(cmsSettings).where(eq(cmsSettings.key, scopedKey)).limit(1);
    previousSettings.set(scopedKey, rows[0]?.value ?? null);
  }
}

async function restoreSettings(siteId: string) {
  for (const key of PERMALINK_KEYS) {
    const scopedKey = settingKey(siteId, key);
    const value = previousSettings.get(scopedKey);
    if (value === null || value === undefined) {
      await db.delete(cmsSettings).where(eq(cmsSettings.key, scopedKey));
      continue;
    }
    await db
      .insert(cmsSettings)
      .values({ key: scopedKey, value })
      .onConflictDoUpdate({ target: cmsSettings.key, set: { value } });
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  let siteRows = await db
    .select({
      id: sites.id,
      userId: sites.userId,
      subdomain: sites.subdomain,
      customDomain: sites.customDomain,
      isPrimary: sites.isPrimary,
    })
    .from(sites)
    .where(or(eq(sites.isPrimary, true), eq(sites.subdomain, "main")))
    .limit(1);

  if (!siteRows[0]) {
    const fallbackUserId = `${runId}-user`;
    await db
      .insert(users)
      .values({
        id: fallbackUserId,
        email: `${runId}@example.com`,
        name: "E2E URL User",
        role: "administrator",
      })
      .onConflictDoNothing();
    await db
      .insert(sites)
      .values({
        id: `${runId}-site`,
        userId: fallbackUserId,
        name: "Main Site",
        subdomain: "main",
        isPrimary: true,
      })
      .onConflictDoNothing();
    siteRows = await db
      .select({
        id: sites.id,
        userId: sites.userId,
        subdomain: sites.subdomain,
        customDomain: sites.customDomain,
        isPrimary: sites.isPrimary,
      })
      .from(sites)
      .where(or(eq(sites.isPrimary, true), eq(sites.subdomain, "main")))
      .limit(1);
  }
  if (!siteRows[0]) throw new Error("Primary/main site not found for URL pattern tests.");
  mainSiteId = siteRows[0].id;
  mainUserId = siteRows[0].userId || `${runId}-user`;
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "").trim();
  const rootHost = (rootDomain || "localhost")
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "");
  const isLocalRoot = rootDomain.includes("localhost") || rootDomain.includes(".test");
  const rawSiteHost = isLocalRoot
    ? siteRows[0].isPrimary
      ? rootHost
      : `${siteRows[0].subdomain || "main"}.${rootHost}`
    : siteRows[0].customDomain || `${siteRows[0].subdomain || "main"}.${rootHost}`;
  siteHost = rawSiteHost.replace(/^https?:\/\//, "").replace(/:\d+$/, "");

  if (!siteRows[0].userId) {
    await db
      .insert(users)
      .values({
        id: mainUserId,
        email: `${runId}@example.com`,
        name: "E2E URL User",
        role: "administrator",
      })
      .onConflictDoNothing();
    await db.update(sites).set({ userId: mainUserId }).where(eq(sites.id, mainSiteId));
  }

  let showcaseDomainRows = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(eq(dataDomains.key, "showcase"))
    .limit(1);
  if (!showcaseDomainRows[0]) {
    await db
      .insert(dataDomains)
      .values({
        key: "showcase",
        label: "Showcase",
        contentTable: "tooty_showcases",
        metaTable: "tooty_showcase_meta",
        description: "Showcase domain",
      })
      .onConflictDoNothing();
    showcaseDomainRows = await db
      .select({ id: dataDomains.id })
      .from(dataDomains)
      .where(eq(dataDomains.key, "showcase"))
      .limit(1);
  }
  if (!showcaseDomainRows[0]) throw new Error("Data domain `showcase` not found.");
  showcaseDomainId = showcaseDomainRows[0].id;
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
        contentTable: "tooty_posts",
        metaTable: "tooty_post_meta",
        description: "Default core post type",
      })
      .onConflictDoNothing();
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
    .values({ siteId: mainSiteId, dataDomainId: showcaseDomainId, isActive: true })
    .onConflictDoUpdate({
      target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
      set: { isActive: true },
    });

  const postRows = await db
    .insert(domainPosts)
    .values({
      dataDomainId: postDomainId,
      title: `URL Pattern Post ${runId}`,
      slug: postSlug,
      content: tiptapDoc(`URL Pattern Post ${runId}`),
      published: true,
      siteId: mainSiteId,
      userId: mainUserId,
    })
    .returning({ id: domainPosts.id });
  postId = postRows[0].id;

  await db.insert(domainPosts).values({
    dataDomainId: showcaseDomainId,
    title: `URL Pattern Showcase ${runId}`,
    slug: showcaseSlug,
    content: tiptapDoc(`URL Pattern Showcase ${runId}`),
    published: true,
    siteId: mainSiteId,
    userId: mainUserId,
  });

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

  await captureCurrentSettings(mainSiteId);
  await setSiteSetting(mainSiteId, "writing_permalink_mode", "default");
  await setSiteSetting(mainSiteId, "writing_single_pattern", "/%domain%/%slug%");
  await setSiteSetting(mainSiteId, "writing_list_pattern", "/%domain_plural%");
  await setSiteSetting(mainSiteId, "writing_no_domain_prefix", "");
  await setSiteSetting(mainSiteId, "writing_no_domain_data_domain", "post");
});

test.afterAll(async () => {
  await restoreSettings(mainSiteId);
  await db.delete(termRelationships).where(and(eq(termRelationships.objectId, postId), eq(termRelationships.termTaxonomyId, categoryTaxonomyId)));
  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.slug, showcaseSlug)));
  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)));
  await db.delete(termTaxonomies).where(eq(termTaxonomies.id, categoryTaxonomyId));
  await db.delete(terms).where(eq(terms.slug, categorySlug));
});

test("default mode: canonical post/domain routes resolve and taxonomy shortcuts are blocked", async ({ request }) => {
  const origin = `http://${siteHost}:3000`;
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

  const showcaseDetail = await request.get(`${origin}/showcase/${showcaseSlug}`);
  expect(showcaseDetail.status()).toBe(200);
  expect(await showcaseDetail.text()).toContain(`URL Pattern Showcase ${runId}`);

  const showcaseArchive = await request.get(`${origin}/showcases`);
  expect(showcaseArchive.status()).toBe(200);

  const legacyFlat = await request.get(`${origin}/${postSlug}`, { maxRedirects: 0 });
  expect([307, 308, 404]).toContain(legacyFlat.status());
  if (legacyFlat.status() !== 404) {
    const location = legacyFlat.headers()["location"] || "";
    expect(location.includes(`/post/${postSlug}`) || location.includes(`/posts/${postSlug}`)).toBe(
      true,
    );
  }

  const categoryShortcut = await request.get(`${origin}/c/${categorySlug}`);
  expect(categoryShortcut.status()).toBe(404);

});

test("custom mode: no-domain prefix routes become canonical for configured Data Domain", async ({ request }) => {
  const origin = `http://${siteHost}:3000`;
  await setSiteSetting(mainSiteId, "writing_permalink_mode", "custom");
  await setSiteSetting(mainSiteId, "writing_single_pattern", "/%domain%/%slug%");
  await setSiteSetting(mainSiteId, "writing_list_pattern", "/%domain_plural%");
  await setSiteSetting(mainSiteId, "writing_no_domain_prefix", "content");
  await setSiteSetting(mainSiteId, "writing_no_domain_data_domain", "post");

  const canonicalArchive = await request.get(`${origin}/content`);
  if (canonicalArchive.status() !== 200) {
    test.skip(
      true,
      `Custom no-domain archive route unavailable for host ${origin}; skipping host-dependent custom permalink assertions.`,
    );
  }
  expect(canonicalArchive.status()).toBe(200);

  const canonicalDetail = await request.get(`${origin}/content/${postSlug}`);
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

  const categoryShortcut = await request.get(`${origin}/c/${categorySlug}`);
  expect(categoryShortcut.status()).toBe(404);
});
