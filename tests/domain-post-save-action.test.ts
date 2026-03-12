import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const createSiteDomainPost = vi.fn(async (input: any) => ({
    id: input.id,
    siteId: input.siteId,
    dataDomainId: input.dataDomainId ?? 1,
    dataDomainKey: input.dataDomainKey ?? "page",
    title: input.title ?? null,
    description: input.description ?? null,
    content: input.content ?? null,
    password: input.password ?? "",
    usePassword: input.usePassword ?? false,
    layout: input.layout ?? null,
    slug: input.slug,
    image: "",
    imageBlurhash: "",
    published: false,
    userId: input.userId ?? "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
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
  const getSiteDomainPostById = vi.fn(async () => null);

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
    userCan: vi.fn(async () => true),
    updateSiteDomainPostById,
    createSiteDomainPost,
    getSiteDomainPostById,
    ensureDefaultCoreDataDomains: vi.fn(async () => undefined),
    findSiteDataDomainByKey: vi.fn(async (_siteId: string, key: string) => ({
      id: 1,
      key,
      label: key === "page" ? "Page" : key,
      isActive: true,
    })),
    replaceSiteDomainPostMeta: vi.fn(async () => undefined),
    listSiteDomainPostMeta: vi.fn(async () => []),
    listScheduleEntries: vi.fn(async () => []),
    createScheduleEntry: vi.fn(async (_ownerType: string, ownerId: string, input: any) => ({
      id: "schedule-1",
      ownerType: "core",
      ownerId,
      actionKey: input.actionKey,
      payload: input.payload,
      nextRunAt: input.nextRunAt,
      enabled: true,
    })),
    updateScheduleEntry: vi.fn(async (id: string, input: any) => ({
      id,
      actionKey: input.actionKey,
      payload: input.payload,
      nextRunAt: input.nextRunAt,
      enabled: input.enabled,
    })),
    deleteScheduleEntry: vi.fn(async () => ({ ok: true })),
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
  userCan: mocks.userCan,
  canUserMutateDomainPost: mocks.canUserMutateDomainPost,
}));

vi.mock("@/lib/db", () => ({
  default: mocks.db,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  countSiteDomainPostUsageByDomain: vi.fn(async () => 0),
  createSiteDomainPost: mocks.createSiteDomainPost,
  deleteSiteDomainPostById: vi.fn(),
  findDomainPostForMutation: vi.fn(),
  getSiteDomainPostById: mocks.getSiteDomainPostById,
  listNetworkDomainPosts: vi.fn(),
  listSiteDomainDefinitions: vi.fn(),
  listSiteDomainPostMeta: mocks.listSiteDomainPostMeta,
  replaceSiteDomainPostMeta: mocks.replaceSiteDomainPostMeta,
  resolveSiteIdForDomainPostId: vi.fn(),
  updateSiteDomainPostById: mocks.updateSiteDomainPostById,
}));

vi.mock("@/lib/default-data-domains", () => ({
  DEFAULT_CORE_DOMAIN_KEYS: ["post", "page"],
  ensureDefaultCoreDataDomains: mocks.ensureDefaultCoreDataDomains,
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  deleteSiteDataDomainById: vi.fn(),
  findSiteDataDomainById: vi.fn(),
  findSiteDataDomainByKey: mocks.findSiteDataDomainByKey,
  listSiteDataDomains: vi.fn(async () => []),
  setSiteDataDomainActivation: vi.fn(),
  updateSiteDataDomainById: vi.fn(),
  upsertSiteDataDomain: vi.fn(),
}));

vi.mock("@/lib/site-taxonomy-tables", () => ({
  ensureSiteTaxonomyTables: mocks.ensureSiteTaxonomyTables,
  getSiteTaxonomyTables: mocks.getSiteTaxonomyTables,
  withSiteTaxonomyTableRecovery: vi.fn(async (_siteId: string, run: () => Promise<unknown>) => run()),
}));

vi.mock("@/lib/scheduler", () => ({
  acquireSchedulerLock: vi.fn(),
  createScheduleEntry: mocks.createScheduleEntry,
  deleteScheduleEntry: mocks.deleteScheduleEntry,
  getScheduleEntryById: vi.fn(),
  listScheduleEntries: mocks.listScheduleEntries,
  listScheduleRunAudits: vi.fn(async () => []),
  releaseSchedulerLock: vi.fn(),
  runScheduleEntryNow: vi.fn(),
  updateScheduleEntry: mocks.updateScheduleEntry,
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
    mocks.userCan.mockClear();
    mocks.updateSiteDomainPostById.mockClear();
    mocks.createSiteDomainPost.mockClear();
    mocks.getSiteDomainPostById.mockClear();
    mocks.ensureDefaultCoreDataDomains.mockClear();
    mocks.findSiteDataDomainByKey.mockClear();
    mocks.replaceSiteDomainPostMeta.mockClear();
    mocks.listSiteDomainPostMeta.mockClear();
    mocks.listScheduleEntries.mockClear();
    mocks.createScheduleEntry.mockClear();
    mocks.updateScheduleEntry.mockClear();
    mocks.deleteScheduleEntry.mockClear();
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

  it("syncs a future _publish_at hidden meta value into the scheduler on save", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const result = await updateDomainPost({
      id: "post-1",
      title: "About Robert Betan",
      slug: "about-robert-betan",
      content: "{\"type\":\"doc\",\"content\":[]}",
      metaEntries: [{ key: "_publish_at", value: futureIso }],
      taxonomyIds: [],
    });

    expect(mocks.replaceSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "page",
      postId: "post-1",
      entries: [{ key: "_publish_at", value: futureIso }],
    });
    expect(mocks.createScheduleEntry).toHaveBeenCalledWith(
      "core",
      "domain-post:post-1",
      expect.objectContaining({
        actionKey: "core.content.publish",
        siteId: "site-1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "post-1",
        slug: "about-robert-betan",
      }),
    );
  });

  it("removes an existing publish schedule when _publish_at is cleared on save", async () => {
    mocks.listScheduleEntries.mockResolvedValueOnce([
      {
        id: "schedule-1",
        ownerType: "core",
        ownerId: "domain-post:post-1",
        actionKey: "core.content.publish",
      },
    ]);

    await updateDomainPost({
      id: "post-1",
      title: "About Robert Betan",
      slug: "about-robert-betan",
      content: "{\"type\":\"doc\",\"content\":[]}",
      metaEntries: [],
      taxonomyIds: [],
    });

    expect(mocks.deleteScheduleEntry).toHaveBeenCalledWith("schedule-1", { isAdmin: true });
  });

  it("creates a new row on first save for placeholder item shells", async () => {
    mocks.canUserMutateDomainPost.mockResolvedValueOnce({
      allowed: false,
      post: null,
    });

    const result = await updateDomainPost({
      id: "draft-1",
      siteId: "site-1",
      dataDomainKey: "page",
      title: "About Robert Betan",
      slug: "",
      content: "{\"type\":\"doc\",\"content\":[]}",
      description: "Updated page",
      usePassword: false,
      taxonomyIds: [],
    });

    expect(mocks.userCan).toHaveBeenCalledWith("site.content.create", "user-1", { siteId: "site-1" });
    expect(mocks.createSiteDomainPost).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "draft-1",
        siteId: "site-1",
        dataDomainKey: "page",
        title: "About Robert Betan",
        slug: "about-robert-betan",
      }),
    );
    expect(mocks.updateSiteDomainPostById).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "draft-1",
        slug: "about-robert-betan",
        created: true,
      }),
    );
  });

  it("passes the requested site hint into mutation authorization before placeholder recovery", async () => {
    mocks.canUserMutateDomainPost.mockResolvedValueOnce({
      allowed: false,
      post: null,
    });

    await updateDomainPost({
      id: "draft-1",
      siteId: "site-1",
      dataDomainKey: "page",
      title: "About Robert Betan",
      slug: "about-robert-betan",
      taxonomyIds: [],
    });

    expect(mocks.canUserMutateDomainPost).toHaveBeenCalledWith(
      "user-1",
      "draft-1",
      "edit",
      "site-1",
    );
  });

  it("retries duplicate-key draft lookup until the freshly created row becomes visible", async () => {
    mocks.canUserMutateDomainPost.mockResolvedValueOnce({
      allowed: false,
      post: null,
    });
    mocks.createSiteDomainPost.mockRejectedValueOnce({ code: "23505" });
    mocks.getSiteDomainPostById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "draft-1",
        siteId: "site-1",
        dataDomainId: 1,
        dataDomainKey: "page",
        title: "About Robert Betan",
        description: "Updated page",
        content: "{\"type\":\"doc\",\"content\":[]}",
        password: "",
        usePassword: false,
        layout: null,
        slug: "about-robert-betan",
        image: "",
        imageBlurhash: "",
        published: false,
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    const result = await updateDomainPost({
      id: "draft-1",
      siteId: "site-1",
      dataDomainKey: "page",
      title: "About Robert Betan",
      slug: "",
      content: "{\"type\":\"doc\",\"content\":[]}",
      description: "Updated page",
      usePassword: false,
      taxonomyIds: [],
    });

    expect(mocks.getSiteDomainPostById).toHaveBeenCalledTimes(3);
    expect(result).toEqual(
      expect.objectContaining({
        id: "draft-1",
        slug: "about-robert-betan",
        created: false,
      }),
    );
  });

  it("applies the pending update after a duplicate-id placeholder race resolves to an existing row", async () => {
    mocks.canUserMutateDomainPost.mockResolvedValueOnce({
      allowed: false,
      post: null,
    });
    mocks.createSiteDomainPost.mockRejectedValueOnce({ code: "23505" });
    mocks.getSiteDomainPostById.mockResolvedValueOnce({
      id: "draft-1",
      siteId: "site-1",
      dataDomainId: 1,
      dataDomainKey: "page",
      title: "Lifecycle About Page",
      description: "Old description",
      content: "{\"type\":\"doc\",\"content\":[]}",
      password: "",
      usePassword: false,
      layout: null,
      slug: "old-slug",
      image: "",
      imageBlurhash: "",
      published: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await updateDomainPost({
      id: "draft-1",
      siteId: "site-1",
      dataDomainKey: "page",
      title: "About Robert Betan",
      slug: "about-robert-betan",
      content: "{\"type\":\"doc\",\"content\":[]}",
      description: "Updated page",
      usePassword: false,
      taxonomyIds: [],
    });

    expect(mocks.updateSiteDomainPostById).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "site-1",
        postId: "draft-1",
        dataDomainKey: "page",
        patch: expect.objectContaining({
          title: "About Robert Betan",
          slug: "about-robert-betan",
        }),
      }),
    );
  });

  it("fails closed on invalid taxonomy ids before mutating post fields", async () => {
    mocks.db.select.mockImplementation(() => {
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
      [],
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

  it("revalidates nested public content routes so page and post permalink updates converge on /page/* and /post/* URLs", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/actions.ts"),
      "utf8",
    );

    expect(source).toContain('revalidatePath("/[domain]/[slug]/[child]", "page");');
  });
});
