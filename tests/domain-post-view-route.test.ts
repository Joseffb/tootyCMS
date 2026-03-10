import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSiteDomainPostById: vi.fn(),
  listSiteDomainPostMeta: vi.fn(),
  upsertSiteDomainPostMeta: vi.fn(),
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  getSiteDomainPostById: mocks.getSiteDomainPostById,
  listSiteDomainPostMeta: mocks.listSiteDomainPostMeta,
  upsertSiteDomainPostMeta: mocks.upsertSiteDomainPostMeta,
}));

import { POST } from "@/app/api/domain-posts/[postId]/view/route";
import { VIEW_COUNT_COOKIE, VIEW_COUNT_META_KEY } from "@/lib/view-count";

function makeRequest(body: Record<string, unknown>, init?: { headers?: Record<string, string> }) {
  return new NextRequest("http://localhost/api/domain-posts/post-1/view", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/domain-posts/[postId]/view", () => {
  beforeEach(() => {
    mocks.getSiteDomainPostById.mockReset();
    mocks.listSiteDomainPostMeta.mockReset();
    mocks.upsertSiteDomainPostMeta.mockReset();

    mocks.getSiteDomainPostById.mockResolvedValue({
      id: "post-1",
      published: true,
      dataDomainKey: "post",
    });
    mocks.listSiteDomainPostMeta.mockResolvedValue([{ key: VIEW_COUNT_META_KEY, value: "4" }]);
    mocks.upsertSiteDomainPostMeta.mockResolvedValue(undefined);
  });

  it("skips known bot traffic", async () => {
    const response = await POST(
      makeRequest(
        { siteId: "site-1", dataDomainKey: "post" },
        {
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          },
        },
      ),
      { params: Promise.resolve({ postId: "post-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ counted: false, reason: "bot" });
    expect(mocks.upsertSiteDomainPostMeta).not.toHaveBeenCalled();
  });

  it("skips repeated views inside the throttle window", async () => {
    const response = await POST(
      makeRequest(
        { siteId: "site-1", dataDomainKey: "post" },
        {
          headers: {
            cookie: `${VIEW_COUNT_COOKIE}=post-1:${Date.now()}`,
          },
        },
      ),
      { params: Promise.resolve({ postId: "post-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ counted: false, reason: "throttled" });
    expect(mocks.upsertSiteDomainPostMeta).not.toHaveBeenCalled();
  });

  it("increments the stored counter for a published post and refreshes the throttle cookie", async () => {
    const response = await POST(
      makeRequest({ siteId: "site-1", dataDomainKey: "post" }),
      { params: Promise.resolve({ postId: "post-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ counted: true, viewCount: 5 });
    expect(mocks.getSiteDomainPostById).toHaveBeenCalledWith({
      siteId: "site-1",
      postId: "post-1",
      dataDomainKey: "post",
    });
    expect(mocks.upsertSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "post",
      postId: "post-1",
      key: VIEW_COUNT_META_KEY,
      value: "5",
    });
    expect(response.headers.get("set-cookie")).toContain(VIEW_COUNT_COOKIE);
  });

  it("starts from zero when hidden view count meta is absent", async () => {
    mocks.listSiteDomainPostMeta.mockResolvedValue([]);

    const response = await POST(
      makeRequest({ siteId: "site-1", dataDomainKey: "post" }),
      { params: Promise.resolve({ postId: "post-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ counted: true, viewCount: 1 });
    expect(mocks.upsertSiteDomainPostMeta).toHaveBeenCalledWith({
      siteId: "site-1",
      dataDomainKey: "post",
      postId: "post-1",
      key: VIEW_COUNT_META_KEY,
      value: "1",
    });
  });
});
