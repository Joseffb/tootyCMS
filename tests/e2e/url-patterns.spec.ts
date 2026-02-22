import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { and, eq, inArray, like, or } from "drizzle-orm";
import {
  cmsSettings,
  dataDomains,
  domainPosts,
  posts,
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
const projectSlug = `${runId}-project`;
const categorySlug = `${runId}-category`;

let mainSiteId = "";
let mainUserId = "";
let postId = "";
let projectDomainId = 0;
let categoryTaxonomyId = 0;
const previousSettings = new Map<string, string | null>();

const settingKey = (siteId: string, key: string) => `site_${siteId}_${key}`;
const PERMALINK_KEYS = [
  "writing_permalink_mode",
  "writing_single_pattern",
  "writing_list_pattern",
  "writing_no_domain_prefix",
  "writing_no_domain_data_domain",
];

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
  const siteRows = await db
    .select({ id: sites.id, userId: sites.userId })
    .from(sites)
    .where(or(eq(sites.isPrimary, true), eq(sites.subdomain, "main")))
    .limit(1);

  if (!siteRows[0]) {
    throw new Error("Primary/main site not found for URL pattern tests.");
  }
  mainSiteId = siteRows[0].id;
  mainUserId = siteRows[0].userId || `${runId}-user`;

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

  const projectDomainRows = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(eq(dataDomains.key, "project"))
    .limit(1);
  if (!projectDomainRows[0]) {
    throw new Error("Data domain `project` not found.");
  }
  projectDomainId = projectDomainRows[0].id;

  await db
    .insert(siteDataDomains)
    .values({ siteId: mainSiteId, dataDomainId: projectDomainId, isActive: true })
    .onConflictDoUpdate({
      target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
      set: { isActive: true },
    });

  const postRows = await db
    .insert(posts)
    .values({
      title: `URL Pattern Post ${runId}`,
      slug: postSlug,
      content: "<p>URL pattern test post body.</p>",
      published: true,
      siteId: mainSiteId,
      userId: mainUserId,
    })
    .returning({ id: posts.id });
  postId = postRows[0].id;

  await db.insert(domainPosts).values({
    dataDomainId: projectDomainId,
    title: `URL Pattern Project ${runId}`,
    slug: projectSlug,
    content: "<p>URL pattern test project body.</p>",
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
  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.slug, projectSlug)));
  await db.delete(posts).where(and(eq(posts.siteId, mainSiteId), eq(posts.slug, postSlug)));
  await db.delete(termTaxonomies).where(eq(termTaxonomies.id, categoryTaxonomyId));
  await db.delete(terms).where(eq(terms.slug, categorySlug));
});

test("default mode: canonical post/domain routes resolve and taxonomy shortcuts are blocked", async ({ page, request }) => {
  const postDetail = await request.get(`http://fernain.test:3000/post/${postSlug}`);
  expect(postDetail.status()).toBe(200);
  expect(await postDetail.text()).toContain(`URL Pattern Post ${runId}`);

  const postArchive = await request.get("http://fernain.test:3000/posts");
  expect(postArchive.status()).toBe(200);
  expect(await postArchive.text()).toContain(`URL Pattern Post ${runId}`);

  const projectDetail = await request.get(`http://fernain.test:3000/project/${projectSlug}`);
  expect(projectDetail.status()).toBe(200);
  expect(await projectDetail.text()).toContain(`URL Pattern Project ${runId}`);

  const projectArchive = await request.get("http://fernain.test:3000/projects");
  expect(projectArchive.status()).toBe(200);

  const legacyFlat = await request.get(`http://fernain.test:3000/${postSlug}`, { maxRedirects: 0 });
  expect([307, 308]).toContain(legacyFlat.status());
  expect(legacyFlat.headers()["location"] || "").toContain(`/post/${postSlug}`);

  const categoryShortcut = await request.get(`http://fernain.test:3000/c/${categorySlug}`);
  expect(categoryShortcut.status()).toBe(404);

  await page.goto(`http://fernain.test:3000/post/${postSlug}`);
  await expect(page.locator("body")).toContainText(`URL Pattern Post ${runId}`);
});

test("custom mode: no-domain prefix routes become canonical for configured Data Domain", async ({ request }) => {
  await setSiteSetting(mainSiteId, "writing_permalink_mode", "custom");
  await setSiteSetting(mainSiteId, "writing_single_pattern", "/%domain%/%slug%");
  await setSiteSetting(mainSiteId, "writing_list_pattern", "/%domain_plural%");
  await setSiteSetting(mainSiteId, "writing_no_domain_prefix", "content");
  await setSiteSetting(mainSiteId, "writing_no_domain_data_domain", "post");

  const canonicalArchive = await request.get("http://fernain.test:3000/content");
  expect(canonicalArchive.status()).toBe(200);
  expect(await canonicalArchive.text()).toContain(`URL Pattern Post ${runId}`);

  const canonicalDetail = await request.get(`http://fernain.test:3000/content/${postSlug}`);
  expect(canonicalDetail.status()).toBe(200);
  expect(await canonicalDetail.text()).toContain(`URL Pattern Post ${runId}`);

  const oldArchive = await request.get("http://fernain.test:3000/posts", { maxRedirects: 0 });
  expect([307, 308]).toContain(oldArchive.status());
  expect(oldArchive.headers()["location"] || "").toContain("/content");

  const oldDetail = await request.get(`http://fernain.test:3000/post/${postSlug}`, { maxRedirects: 0 });
  expect([307, 308]).toContain(oldDetail.status());
  expect(oldDetail.headers()["location"] || "").toContain(`/content/${postSlug}`);

  const categoryShortcut = await request.get(`http://fernain.test:3000/c/${categorySlug}`);
  expect(categoryShortcut.status()).toBe(200);
});
