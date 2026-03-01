import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dataDomains, domainPosts, sites, users } from "../../lib/schema";

const db = drizzle(sql);
const runId = `e2e-record-${randomUUID()}`;
const postSlug = `${runId}-post`;

let siteId = "";
let userId = "";
let postDomainId = 0;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userId = `${runId}-user`;
  siteId = `${runId}-site`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${runId}@example.com`,
      name: "E2E Record User",
      role: "administrator",
    })
    .onConflictDoNothing();
  await db
    .insert(sites)
    .values({
      id: siteId,
      userId,
      name: "Record Lifecycle Site",
      subdomain: `${runId}-site`,
      isPrimary: false,
    })
    .onConflictDoNothing();

  let domainRows = await db.select({ id: dataDomains.id }).from(dataDomains).where(eq(dataDomains.key, "post")).limit(1);
  if (!domainRows[0]) {
    await db
      .insert(dataDomains)
      .values({
        key: "post",
        label: "Post",
        contentTable: "posts",
        metaTable: "post_meta",
        description: "Default core post type",
      })
      .onConflictDoNothing();
    domainRows = await db
      .select({ id: dataDomains.id })
      .from(dataDomains)
      .where(eq(dataDomains.key, "post"))
      .limit(1);
  }
  if (!domainRows[0]) throw new Error("Post data domain not found for record lifecycle e2e.");
  postDomainId = domainRows[0].id;
});

test("post record lifecycle: add and delete record", async () => {
  await db.insert(domainPosts).values({
    dataDomainId: postDomainId,
    title: `E2E Lifecycle ${runId}`,
    slug: postSlug,
    content: "<p>E2E lifecycle content.</p>",
    published: true,
    siteId,
  });

  const created = await db
    .select({ id: domainPosts.id, slug: domainPosts.slug })
    .from(domainPosts)
    .where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)))
    .limit(1);
  expect(created[0]?.slug).toBe(postSlug);

  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)));

  const removed = await db
    .select({ id: domainPosts.id })
    .from(domainPosts)
    .where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomainId), eq(domainPosts.slug, postSlug)))
    .limit(1);
  expect(removed).toHaveLength(0);
});
