import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const updateSiteDomainPostById = vi.fn(async ({ postId, patch }: any) => ({
    id: postId,
    title: patch.title ?? null,
    description: patch.description ?? null,
    slug: patch.slug ?? "old-slug",
    content: patch.content ?? null,
    password: patch.password ?? "",
    usePassword: patch.usePassword ?? false,
    layout: patch.layout ?? null,
  }));

  const db = {
    query: {
      sites: {
        findFirst: vi.fn(async () => ({ subdomain: "main", customDomain: null })),
      },
    },
    transaction: vi.fn(async (cb: any) =>
      cb({
        execute: vi.fn(async () => undefined),
        delete: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
        })),
        insert: vi.fn(async () => undefined),
      }),
    ),
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(async () => []),
      };
      return chain;
    }),
  };

  return {
    getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
    canUserMutateDomainPost: vi.fn(async () => ({
      allowed: true,
      post: {
        id: "post-1",
        siteId: "site-1",
        slug: "old-slug",
        dataDomainKey: "page",
      },
    })),
    updateSiteDomainPostById,
    replaceSiteDomainPostMeta: vi.fn(async () => undefined),
    listSiteDomainPostMeta: vi.fn(async () => []),
    ensureSiteTaxonomyTables: vi.fn(async () => undefined),
    getSiteTaxonomyTables: vi.fn(() => ({
      termRelationshipsTable: {
        objectId: "objectId",
        termTaxonomyId: "termTaxonomyId",
      },
      termTaxonomiesTable: {
        id: "id",
        taxonomy: "taxonomy",
      },
    })),
    revalidateTag: vi.fn(),
    revalidatePath: vi.fn(),
    db,
  };
});

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
  MIMIC_ACTOR_COOKIE: "mimic_actor",
  MIMIC_TARGET_COOKIE: "mimic_target",
  withSiteAuth: (handler: any) => handler,
  withPostAuth: (handler: any) => handler,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: vi.fn(async () => true),
  canUserMutateDomainPost: mocks.canUserMutateDomainPost,
}));

vi.mock("@/lib/db", () => ({
  default: mocks.db,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  countSiteDomainPostUsageByDomain: vi.fn(async () => 0),
  createSiteDomainPost: vi.fn(),
  deleteSiteDomainPostById: vi.fn(),
  findDomainPostForMutation: vi.fn(),
  getSiteDomainPostById: vi.fn(),
  listNetworkDomainPosts: vi.fn(),
  listSiteDomainDefinitions: vi.fn(),
  listSiteDomainPostMeta: mocks.listSiteDomainPostMeta,
  replaceSiteDomainPostMeta: mocks.replaceSiteDomainPostMeta,
  resolveSiteIdForDomainPostId: vi.fn(),
  updateSiteDomainPostById: mocks.updateSiteDomainPostById,
}));

vi.mock("@/lib/site-taxonomy-tables", () => ({
  ensureSiteTaxonomyTables: mocks.ensureSiteTaxonomyTables,
  getSiteTaxonomyTables: mocks.getSiteTaxonomyTables,
  withSiteTaxonomyTableRecovery: vi.fn(async (_siteId: string, run: () => Promise<unknown>) => run()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

import { updateDomainPost } from "@/lib/actions";

describe("updateDomainPost", () => {
  beforeEach(() => {
    mocks.getSession.mockClear();
    mocks.canUserMutateDomainPost.mockClear();
    mocks.updateSiteDomainPostById.mockClear();
    mocks.replaceSiteDomainPostMeta.mockClear();
    mocks.listSiteDomainPostMeta.mockClear();
    mocks.ensureSiteTaxonomyTables.mockClear();
    mocks.getSiteTaxonomyTables.mockClear();
    mocks.revalidateTag.mockClear();
    mocks.revalidatePath.mockClear();
    mocks.db.query.sites.findFirst.mockClear();
    mocks.db.transaction.mockClear();
    mocks.db.select.mockClear();
  });

  it("persists title and slug through the full editor save action", async () => {
    const result = await updateDomainPost({
      id: "post-1",
      title: "About Robert Betan",
      slug: "about-robert-betan-",
      content: "{\"type\":\"doc\",\"content\":[]}",
      description: "Updated page",
      usePassword: false,
      taxonomyIds: [],
    });

    expect(mocks.updateSiteDomainPostById).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "site-1",
        postId: "post-1",
        dataDomainKey: "page",
        patch: expect.objectContaining({
          title: "About Robert Betan",
          slug: "about-robert-betan",
        }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        title: "About Robert Betan",
        slug: "about-robert-betan",
      }),
    );
  });

  it("fails closed on invalid taxonomy ids before mutating post fields", async () => {
    mocks.db.select.mockImplementationOnce(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(async () => [{ id: 10 }]),
      };
      return chain;
    });

    const result = await updateDomainPost({
      id: "post-1",
      title: "Should Not Persist",
      slug: "should-not-persist",
      taxonomyIds: [10, 11],
    });

    expect(result).toEqual({
      error: "One or more taxonomy terms are invalid for this site.",
    });
    expect(mocks.updateSiteDomainPostById).not.toHaveBeenCalled();
  });

  it("normalizes taxonomy ids from string-valued editor payloads before rewriting relationships", async () => {
    const selectResults = [
      [{ id: 10 }, { id: 11 }],
    ];
    mocks.db.select.mockImplementation(() => {
      const rows = selectResults.shift() ?? [];
      const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(async () => rows),
      };
      return chain;
    });

    const insertValues = vi.fn();
    mocks.db.transaction.mockImplementation(async (cb: any) =>
      cb({
        execute: vi.fn(async () => undefined),
        delete: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [{ id: 10 }, { id: 11 }]),
          })),
        })),
        insert: vi.fn(() => {
          const chain: any = {
            values: vi.fn((values: unknown) => {
              insertValues(values);
              return chain;
            }),
            onConflictDoNothing: vi.fn(async () => undefined),
          };
          return chain;
        }),
      }),
    );

    const result = await updateDomainPost({
      id: "post-1",
      title: "Taxonomy Strings",
      taxonomyIds: ["10", "11"],
      selectedTermsByTaxonomy: {
        category: ["10"],
        tag: ["11"],
      },
    });

    expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(insertValues).toHaveBeenCalledWith([
      { objectId: "post-1", termTaxonomyId: 10 },
      { objectId: "post-1", termTaxonomyId: 11 },
    ]);
  });

  it("serializes taxonomy relationship rewrites at the site level to avoid shared-table deadlocks", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/actions.ts"),
      "utf8",
    );

    expect(source).toContain('const advisoryKey = `${existing.siteId}:domain-post-taxonomies`;');
    expect(source).not.toContain('const advisoryKey = `${existing.siteId}:domain-post-taxonomies:${data.id}`;');
  });

  it("retries taxonomy relationship rewrites on deadlock-class site write conflicts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/actions.ts"),
      "utf8",
    );

    expect(source).toContain("function isRetryableSiteWriteLockError(error: unknown) {");
    expect(source).toContain('return candidate.code === "40P01" || candidate.code === "55P03";');
    expect(source).toContain("async function withRetryableSiteWrite<T>(run: () => Promise<T>, attempts = 5): Promise<T> {");
    expect(source).toContain("await withRetryableSiteWrite(() =>");
  });
});
