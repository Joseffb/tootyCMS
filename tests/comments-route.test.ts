import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findUserMeta = vi.fn();
  const findUser = vi.fn();
  return {
    getSession: vi.fn(),
    verifyThemeBridgeToken: vi.fn(),
    canUserViewComments: vi.fn(),
    getPublicCommentCapabilities: vi.fn(),
    listPublicComments: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    hasPostPasswordAccess: vi.fn(),
    cookies: vi.fn(),
    getSiteDomainPostById: vi.fn(),
    db: {
      query: {
        domainPosts: {
          findFirst: vi.fn(),
        },
        userMeta: {
          findFirst: findUserMeta,
        },
        users: {
          findFirst: findUser,
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/comments-spine", () => ({
  canUserViewComments: mocks.canUserViewComments,
  createComment: mocks.createComment,
  getPublicCommentCapabilities: mocks.getPublicCommentCapabilities,
  listComments: mocks.listComments,
  listPublicComments: mocks.listPublicComments,
}));

vi.mock("@/lib/theme-auth-bridge", () => ({
  verifyThemeBridgeToken: mocks.verifyThemeBridgeToken,
}));

vi.mock("@/lib/post-password", () => ({
  hasPostPasswordAccess: mocks.hasPostPasswordAccess,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/db", () => ({
  default: mocks.db,
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  getSiteDomainPostById: mocks.getSiteDomainPostById,
}));

import { GET, POST } from "@/app/api/comments/route";

describe("comments route identity enforcement", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.verifyThemeBridgeToken.mockReset();
    mocks.canUserViewComments.mockReset();
    mocks.getPublicCommentCapabilities.mockReset();
    mocks.listPublicComments.mockReset();
    mocks.listComments.mockReset();
    mocks.createComment.mockReset();
    mocks.hasPostPasswordAccess.mockReset();
    mocks.cookies.mockReset();
    mocks.getSiteDomainPostById.mockReset();
    mocks.db.query.domainPosts.findFirst.mockReset();
    mocks.db.query.userMeta.findFirst.mockReset();
    mocks.db.query.users.findFirst.mockReset();
    mocks.db.select.mockClear();

    mocks.getPublicCommentCapabilities.mockResolvedValue({
      commentsVisibleToPublic: true,
      canPostAuthenticated: true,
      canPostAnonymously: true,
      anonymousIdentityFields: { name: true, email: true },
    });
    mocks.canUserViewComments.mockResolvedValue(true);
    mocks.listPublicComments.mockResolvedValue([]);
    mocks.listComments.mockResolvedValue([]);
    mocks.hasPostPasswordAccess.mockResolvedValue(false);
    mocks.cookies.mockResolvedValue(new Map());
    mocks.getSiteDomainPostById.mockResolvedValue(null);
    mocks.db.query.domainPosts.findFirst.mockResolvedValue(null);
    mocks.verifyThemeBridgeToken.mockResolvedValue(null);
  });

  it("uses authenticated display_name for signed-in comments and never exposes email", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.db.query.userMeta.findFirst.mockResolvedValue({ value: "Display Alias" });
    mocks.db.query.users.findFirst.mockResolvedValue({ id: "user-1", username: "internal_user" });
    mocks.createComment.mockResolvedValue({
      id: "comment-1",
      metadata: {
        author_display_name: "Display Alias",
        author_name: "Display Alias",
        author_email: "private@example.com",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/comments", {
        method: "POST",
        headers: {
          cookie: "next-auth.session-token=session-token",
        },
        body: JSON.stringify({
          siteId: "site-1",
          contextType: "entry",
          contextId: "entry-1",
          body: "hello",
          authorName: "Injected Name",
          authorEmail: "leak@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createComment).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    const payload = mocks.createComment.mock.calls[0][0];
    expect(payload.actorUserId).toBe("user-1");
    expect(payload.metadata.author_display_name).toBe("Display Alias");
    expect(payload.metadata.author_name).toBe("Display Alias");
    expect(payload.metadata.author_email).toBeUndefined();

    const json = await response.json();
    expect(json.item.metadata.author_display_name).toBe("Display Alias");
    expect(String(json.item.metadata.author_email || "")).toBe("");
    expect(String(JSON.stringify(json))).not.toContain("leak@example.com");
  });

  it("allows anonymous create while keeping email out of public response payload", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.db.query.users.findFirst.mockResolvedValue(null);
    mocks.createComment.mockResolvedValue({
      id: "comment-2",
      metadata: {
        author_display_name: "Anon User",
        author_email: "anon@example.com",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/comments", {
        method: "POST",
        body: JSON.stringify({
          siteId: "site-1",
          contextType: "entry",
          contextId: "entry-1",
          body: "anonymous",
          authorName: "Anon User",
          authorEmail: "anon@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSession).not.toHaveBeenCalled();
    const payload = mocks.createComment.mock.calls[0][0];
    expect(payload.actorUserId).toBeNull();
    expect(payload.metadata.author_display_name).toBe("Anon User");
    expect(payload.metadata.author_email).toBe("anon@example.com");

    const json = await response.json();
    expect(json.item.metadata.author_display_name).toBe("Anon User");
    expect(String(json.item.metadata.author_email || "")).toBe("");
    expect(String(JSON.stringify(json))).not.toContain("anon@example.com");
  });

  it("sanitizes email fields from comment list output", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.db.query.users.findFirst.mockResolvedValue(null);
    mocks.listPublicComments.mockResolvedValue([
      {
        id: "comment-3",
        authorId: null,
        metadata: {
          author_display_name: "Anon User",
          author_email: "anon@example.com",
          email: "alt@example.com",
          reviewer_email: "admin@example.com",
        },
      },
    ]);

    const response = await GET(
      new Request(
        "http://localhost/api/comments?siteId=site-1&contextType=entry&contextId=entry-1&limit=10&offset=0",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSession).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].metadata.author_display_name).toBe("Anon User");
    expect(String(json.items[0].metadata.author_email || "")).toBe("");
    expect(String(json.items[0].metadata.email || "")).toBe("");
    expect(String(json.items[0].metadata.reviewer_email || "")).toBe("");
    expect(JSON.stringify(json.items[0].metadata)).not.toContain("@example.com");
  });

  it("accepts a valid theme bridge token even when the session is absent", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.verifyThemeBridgeToken.mockResolvedValue({
      sub: "user-1",
      aud: "theme-bridge",
    });
    mocks.db.query.users.findFirst.mockResolvedValue({ id: "user-1", username: "internal_user" });

    const response = await GET(
      new Request(
        "http://localhost/api/comments?siteId=site-1&contextType=entry&contextId=entry-1&view=capabilities",
        {
          headers: {
            "x-tooty-theme-bridge": "valid-bridge-token",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.verifyThemeBridgeToken).toHaveBeenCalledWith("valid-bridge-token");

    const json = await response.json();
    expect(json.permissions.isAuthenticated).toBe(true);
    expect(json.permissions.canPostAsUser).toBe(true);
  });

  it("skips session lookup for public capability reads when no auth cookie or bridge header exists", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/comments?siteId=site-1&contextType=entry&contextId=entry-1&view=capabilities",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.verifyThemeBridgeToken).not.toHaveBeenCalled();
  });
});
