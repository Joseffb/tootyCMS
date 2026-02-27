import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userCan: vi.fn(),
  createKernelForRequest: vi.fn(),
  ensureSiteCommentTables: vi.fn(),
  emitDomainEvent: vi.fn(),
  createId: vi.fn(),
  dbExecute: vi.fn(),
  communicationInsertValues: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/site-comment-tables", () => ({
  ensureSiteCommentTables: mocks.ensureSiteCommentTables,
}));

vi.mock("@/lib/domain-dispatch", () => ({
  emitDomainEvent: mocks.emitDomainEvent,
}));

vi.mock("@paralleldrive/cuid2", () => ({
  createId: mocks.createId,
}));

vi.mock("@/lib/db", () => ({
  default: {
    execute: (...args: any[]) => mocks.dbExecute(...args),
    insert: () => ({
      values: (...args: any[]) => {
        mocks.communicationInsertValues(...args);
      },
    }),
    query: {
      domainPosts: {
        findFirst: vi.fn().mockResolvedValue({ id: "entry-1" }),
      },
    },
  },
}));

describe("comments spine invariants", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.userCan.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.ensureSiteCommentTables.mockReset();
    mocks.emitDomainEvent.mockReset();
    mocks.createId.mockReset();
    mocks.dbExecute.mockReset();
    mocks.communicationInsertValues.mockReset();
    mocks.createId.mockReturnValue("comment-new-1");
  });

  it("rejects update when actor is neither author nor moderator", async () => {
    mocks.userCan.mockResolvedValue(false);
    const provider = {
      pluginId: "tooty-comments",
      id: "tooty-comments",
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      moderate: vi.fn(),
      list: vi.fn(async () => [
        {
          id: "comment-1",
          siteId: "site-1",
          contextType: "entry",
          contextId: "entry-1",
          authorId: "author-1",
          body: "body",
          status: "approved",
          parentId: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };
    mocks.createKernelForRequest.mockResolvedValue({
      getAllPluginCommentProviders: () => [provider],
      doAction: vi.fn(),
    });
    const { updateComment } = await import("@/lib/comments-spine");

    await expect(
      updateComment({
        id: "comment-1",
        siteId: "site-1",
        actorUserId: "user-2",
        body: "changed",
      }),
    ).rejects.toThrow(/only comment author or moderator/i);
    expect(provider.update).not.toHaveBeenCalled();
  });

  it("rejects moderation status outside pending/approved/rejected", async () => {
    mocks.userCan.mockResolvedValue(true);
    const provider = {
      pluginId: "tooty-comments",
      id: "tooty-comments",
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      moderate: vi.fn(),
      list: vi.fn(),
    };
    mocks.createKernelForRequest.mockResolvedValue({
      getAllPluginCommentProviders: () => [provider],
      doAction: vi.fn(),
    });
    const { moderateComment } = await import("@/lib/comments-spine");

    await expect(
      moderateComment({
        id: "comment-1",
        siteId: "site-1",
        actorUserId: "admin-1",
        status: "spam" as any,
      }),
    ).rejects.toThrow(/unsupported moderation status/i);
    expect(provider.moderate).not.toHaveBeenCalled();
  });

  it("prevents creating nested replies deeper than one level in core provider", async () => {
    mocks.userCan.mockResolvedValue(true);
    mocks.ensureSiteCommentTables.mockResolvedValue({
      commentsTable: "tooty_site_0_comments",
      commentMetaTable: "tooty_site_0_comment_meta",
    });
    mocks.createKernelForRequest.mockResolvedValue({
      getAllPluginCommentProviders: () => [],
      applyFilters: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
      doAction: vi.fn(),
    });
    mocks.dbExecute.mockImplementation(async (query: any) => {
      const text = String(query?.queryChunks?.map((chunk: any) => String(chunk?.value ?? "")).join(" ") || "");
      if (text.toLowerCase().includes("select \"id\", \"parent_id\"")) {
        return { rows: [{ id: "parent-1", parent_id: "root-1" }] };
      }
      return { rows: [] };
    });
    const { createComment } = await import("@/lib/comments-spine");

    await expect(
      createComment({
        siteId: "site-1",
        contextType: "group",
        contextId: "group-1",
        actorUserId: "author-1",
        body: "reply",
        parentId: "parent-1",
      }),
    ).rejects.toThrow(/one level of comment threading/i);
  });

  it("blocks comment creation when entry context is not in site scope", async () => {
    mocks.userCan.mockResolvedValue(true);
    mocks.ensureSiteCommentTables.mockResolvedValue({
      commentsTable: "tooty_site_0_comments",
      commentMetaTable: "tooty_site_0_comment_meta",
    });
    mocks.createKernelForRequest.mockResolvedValue({
      getAllPluginCommentProviders: () => [],
      applyFilters: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
      doAction: vi.fn(),
    });
    const dbModule = await import("@/lib/db");
    (dbModule.default.query.domainPosts.findFirst as any).mockResolvedValueOnce(null);
    const { createComment } = await import("@/lib/comments-spine");

    await expect(
      createComment({
        siteId: "site-1",
        contextType: "entry",
        contextId: "entry-other-site",
        actorUserId: "author-1",
        body: "reply",
      }),
    ).rejects.toThrow(/context entry was not found for this site/i);
  });
});
