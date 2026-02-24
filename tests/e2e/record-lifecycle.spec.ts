import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { and, eq } from "drizzle-orm";
import { dataDomains, domainPosts, sites } from "../../lib/schema";

const db = drizzle(sql);
const runId = `e2e-record-${Date.now()}`;
const postSlug = `${runId}-post`;

let mainSiteId = "";
let postDomainId = 0;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const siteRows = await db
    .select({ id: sites.id, subdomain: sites.subdomain, customDomain: sites.customDomain })
    .from(sites)
    .where(eq(sites.isPrimary, true))
    .limit(1);

  if (!siteRows[0]) {
    throw new Error("Primary site not found for record lifecycle e2e.");
  }

  mainSiteId = siteRows[0].id;
  const domainRows = await db.select({ id: dataDomains.id }).from(dataDomains).where(eq(dataDomains.key, "post")).limit(1);
  if (!domainRows[0]) throw new Error("Post data domain not found for record lifecycle e2e.");
  postDomainId = domainRows[0].id;
});

test.afterAll(async () => {
  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)));
});

test("post record lifecycle: add and delete record", async () => {
  await db.insert(domainPosts).values({
    dataDomainId: postDomainId,
    title: `E2E Lifecycle ${runId}`,
    slug: postSlug,
    content: "<p>E2E lifecycle content.</p>",
    published: true,
    siteId: mainSiteId,
  });

  const created = await db
    .select({ id: domainPosts.id, slug: domainPosts.slug })
    .from(domainPosts)
    .where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)))
    .limit(1);
  expect(created[0]?.slug).toBe(postSlug);

  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)));

  const removed = await db
    .select({ id: domainPosts.id })
    .from(domainPosts)
    .where(and(eq(domainPosts.siteId, mainSiteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)))
    .limit(1);
  expect(removed).toHaveLength(0);
});
