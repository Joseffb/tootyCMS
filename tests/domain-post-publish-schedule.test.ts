import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listSiteDomainPostMeta = vi.fn(async () => []);
  const replaceSiteDomainPostMeta = vi.fn(async () => undefined);
  const deleteSiteDomainPostMeta = vi.fn(async () => undefined);
  const setDomainPostPublishedState = vi.fn(async () => ({
    ok: true,
    post: {
      id: "post-1",
      slug: "about-this-site",
      published: true,
    },
  }));
  const listScheduleEntries = vi.fn(async () => []);
  const createScheduleEntry = vi.fn(async (_ownerType: string, ownerId: string, input: any) => ({
    id: "schedule-1",
    ownerType: "core",
    ownerId,
    actionKey: input.actionKey,
    payload: input.payload,
    nextRunAt: input.nextRunAt,
    enabled: true,
  }));
  const updateScheduleEntry = vi.fn(async (id: string, input: any) => ({
    id,
    actionKey: input.actionKey,
    payload: input.payload,
    nextRunAt: input.nextRunAt,
    enabled: input.enabled,
  }));
  const deleteScheduleEntry = vi.fn(async () => ({ ok: true }));

  return {
    getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
    canUserMutateDomainPost: vi.fn(async () => ({
      allowed: true,
      post: {
        id: "post-1",
        siteId: "site-1",
        dataDomainKey: "page",
        slug: "about-this-site",
        title: "About This Site",
        published: false,
      },
    })),
    userCan: vi.fn(async () => true),
    canTransitionContentState: vi.fn(async () => true),
    stateFromPublishedFlag: vi.fn((published: boolean) => (published ? "published" : "draft")),
    listSiteDomainPostMeta,
    replaceSiteDomainPostMeta,
    deleteSiteDomainPostMeta,
    updateSiteDomainPostById: vi.fn(async ({ postId, patch }: any) => ({
      id: postId,
      slug: patch.slug ?? "about-this-site",
      published: false,
    })),
    setDomainPostPublishedState,
    listScheduleEntries,
    createScheduleEntry,
    updateScheduleEntry,
    deleteScheduleEntry,
    db: {
      query: {
        sites: {
          findFirst: vi.fn(async () => ({ subdomain: "main", customDomain: null })),
        },
      },
    },
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
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

vi.mock("@/lib/content-state-engine", () => ({
  canTransitionContentState: mocks.canTransitionContentState,
  stateFromPublishedFlag: mocks.stateFromPublishedFlag,
}));

vi.mock("@/lib/content-lifecycle", () => ({
  setDomainPostPublishedState: mocks.setDomainPostPublishedState,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  countSiteDomainPostUsageByDomain: vi.fn(async () => 0),
  createSiteDomainPost: vi.fn(),
  deleteSiteDomainPostById: vi.fn(),
  deleteSiteDomainPostMeta: mocks.deleteSiteDomainPostMeta,
  findDomainPostForMutation: vi.fn(),
  getSiteDomainPostById: vi.fn(),
  listNetworkDomainPosts: vi.fn(),
  listSiteDomainDefinitions: vi.fn(),
  listSiteDomainPostMeta: mocks.listSiteDomainPostMeta,
  replaceSiteDomainPostMeta: mocks.replaceSiteDomainPostMeta,
  resolveSiteIdForDomainPostId: vi.fn(),
  updateSiteDomainPostById: mocks.updateSiteDomainPostById,
}));

vi.mock("@/lib/scheduler", () => ({
  acquireSchedulerLock: vi.fn(),
  createScheduleEntry: mocks.createScheduleEntry,
  deleteScheduleEntry: mocks.deleteScheduleEntry,
  listScheduleEntries: mocks.listScheduleEntries,
  listScheduleRunAudits: vi.fn(async () => []),
  releaseSchedulerLock: vi.fn(),
  runScheduleEntryNow: vi.fn(),
  updateScheduleEntry: mocks.updateScheduleEntry,
}));

vi.mock("@/lib/db", () => ({
  default: mocks.db,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

import { updateDomainPostMetadata } from "@/lib/actions";

describe("updateDomainPostMetadata scheduled publish", () => {
  beforeEach(() => {
    mocks.getSession.mockClear();
    mocks.canUserMutateDomainPost.mockClear();
    mocks.userCan.mockClear();
    mocks.canTransitionContentState.mockClear();
    mocks.stateFromPublishedFlag.mockClear();
    mocks.listSiteDomainPostMeta.mockReset();
    mocks.listSiteDomainPostMeta.mockResolvedValue([]);
    mocks.replaceSiteDomainPostMeta.mockClear();
    mocks.deleteSiteDomainPostMeta.mockClear();
    mocks.updateSiteDomainPostById.mockClear();
    mocks.setDomainPostPublishedState.mockClear();
    mocks.listScheduleEntries.mockReset();
    mocks.listScheduleEntries.mockResolvedValue([]);
    mocks.createScheduleEntry.mockClear();
    mocks.updateScheduleEntry.mockClear();
    mocks.deleteScheduleEntry.mockClear();
    mocks.revalidatePath.mockClear();
    mocks.revalidateTag.mockClear();
  });

  it("creates a scheduler entry instead of publishing immediately when _publish_at is in the future", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: "_publish_at", value: futureIso }]);

    const formData = new FormData();
    formData.append("published", "true");
    const result = await updateDomainPostMetadata(formData, "post-1", "published");

    expect(mocks.createScheduleEntry).toHaveBeenCalledWith(
      "core",
      "domain-post:post-1",
      expect.objectContaining({
        actionKey: "core.content.publish",
        siteId: "site-1",
        payload: expect.objectContaining({
          domainPostId: "post-1",
          contentId: "post-1",
          siteId: "site-1",
          runOnce: true,
        }),
      }),
    );
    expect(mocks.setDomainPostPublishedState).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        scheduled: true,
        published: false,
        publishAt: futureIso,
      }),
    );
  });

  it("publishes immediately and clears stale _publish_at when the timestamp is due", async () => {
    const dueIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: "_publish_at", value: dueIso }]);
    mocks.listScheduleEntries.mockResolvedValue([
      {
        id: "schedule-1",
        ownerType: "core",
        ownerId: "domain-post:post-1",
        actionKey: "core.content.publish",
      },
    ]);

    const formData = new FormData();
    formData.append("published", "true");
    const result = await updateDomainPostMetadata(formData, "post-1", "published");

    expect(mocks.deleteScheduleEntry).toHaveBeenCalledWith("schedule-1", { isAdmin: true });
    expect(mocks.setDomainPostPublishedState).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "post-1",
        nextPublished: true,
      }),
    );
    expect(mocks.deleteSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "page",
      postId: "post-1",
      key: "_publish_at",
    });
    expect(result).toEqual(
      expect.objectContaining({
        published: true,
        publishAt: null,
      }),
    );
  });

  it("updates an existing scheduler entry when _publish_at changes", async () => {
    const futureIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: "_publish_at", value: "old-value" }]);
    mocks.listScheduleEntries.mockResolvedValue([
      {
        id: "schedule-1",
        ownerType: "core",
        ownerId: "domain-post:post-1",
        actionKey: "core.content.publish",
      },
    ]);

    const formData = new FormData();
    formData.append("publishAt", futureIso);
    const result = await updateDomainPostMetadata(formData, "post-1", "_publish_at");

    expect(mocks.replaceSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "page",
      postId: "post-1",
      entries: [{ key: "_publish_at", value: futureIso }],
    });
    expect(mocks.updateScheduleEntry).toHaveBeenCalledWith(
      "schedule-1",
      expect.objectContaining({
        actionKey: "core.content.publish",
        enabled: true,
        siteId: "site-1",
      }),
      { isAdmin: true },
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        publishAt: futureIso,
      }),
    );
  });

  it("clears _publish_at and removes an existing schedule when the value is emptied", async () => {
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: "_publish_at", value: "old-value" }]);
    mocks.listScheduleEntries.mockResolvedValue([
      {
        id: "schedule-1",
        ownerType: "core",
        ownerId: "domain-post:post-1",
        actionKey: "core.content.publish",
      },
    ]);

    const formData = new FormData();
    formData.append("publishAt", "");
    const result = await updateDomainPostMetadata(formData, "post-1", "_publish_at");

    expect(mocks.replaceSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "page",
      postId: "post-1",
      entries: [],
    });
    expect(mocks.deleteScheduleEntry).toHaveBeenCalledWith("schedule-1", { isAdmin: true });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        publishAt: null,
      }),
    );
  });
});
