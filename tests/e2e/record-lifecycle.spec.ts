import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { deleteSitePost, ensureCoreSiteDomain, ensureNetworkSite, ensureNetworkUser, ensureSitePost } from "./helpers/storage";
import { getSiteDomainPostBySlug } from "../../lib/site-domain-post-store";
import { tiptapParagraph } from "./helpers/tiptap";
const runId = `e2e-record-${randomUUID()}`;
const postSlug = `${runId}-post`;

let siteId = "";
let userId = "";
let postDomainId = 0;

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  userId = `${runId}-user`;
  siteId = `${runId}-site`;
  await ensureNetworkUser({
    id: userId,
    email: `${runId}@example.com`,
    name: "E2E Record User",
    role: "administrator",
    authProvider: "native",
  });
  await ensureNetworkSite({
    id: siteId,
    userId,
    name: "Record Lifecycle Site",
    subdomain: `${runId}-site`,
    isPrimary: false,
  });
  const domain = await ensureCoreSiteDomain(siteId, "post");
  postDomainId = domain.id;
});

test("post record lifecycle: add and delete record", async () => {
  await ensureSitePost({
    id: `${runId}-post-id`,
    siteId,
    domainKey: "post",
    userId,
    title: `E2E Lifecycle ${runId}`,
    slug: postSlug,
    content: tiptapParagraph("E2E lifecycle content."),
    published: true,
  });

  const created = await getSiteDomainPostBySlug({ siteId, slug: postSlug, dataDomainKey: "post", published: true });
  expect(created?.slug).toBe(postSlug);

  await deleteSitePost(siteId, "post", String(created?.id || ""));

  const removed = await getSiteDomainPostBySlug({ siteId, slug: postSlug, dataDomainKey: "post", published: true });
  expect(removed).toBeNull();
});
