import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_COUNT_META_KEY } from "@/lib/view-count";

const mocks = vi.hoisted(() => ({
  listSiteDomainPostMetaMany: vi.fn(),
}));

vi.mock("@/lib/site-domain-post-store", () => ({
  listSiteDomainPostMetaMany: mocks.listSiteDomainPostMetaMany,
}));

import { getViewCountsByPost } from "@/lib/dashboard-popularity";

describe("dashboard popularity helpers", () => {
  beforeEach(() => {
    mocks.listSiteDomainPostMetaMany.mockReset();
  });

  it("reads view counts across site/domain buckets and defaults invalid values to zero", async () => {
    mocks.listSiteDomainPostMetaMany
      .mockResolvedValueOnce([
        { domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "12" },
      ])
      .mockResolvedValueOnce([
        { domainPostId: "post-2", key: VIEW_COUNT_META_KEY, value: "bad" },
      ]);

    const counts = await getViewCountsByPost([
      { id: "post-1", siteId: "site-1", dataDomainKey: "post" },
      { id: "post-2", siteId: "site-1", dataDomainKey: "page" },
    ]);

    expect(mocks.listSiteDomainPostMetaMany).toHaveBeenNthCalledWith(1, {
      siteId: "site-1",
      dataDomainKey: "post",
      postIds: ["post-1"],
      keys: [VIEW_COUNT_META_KEY],
    });
    expect(mocks.listSiteDomainPostMetaMany).toHaveBeenNthCalledWith(2, {
      siteId: "site-1",
      dataDomainKey: "page",
      postIds: ["post-2"],
      keys: [VIEW_COUNT_META_KEY],
    });
    expect(counts.get("post-1")).toBe(12);
    expect(counts.get("post-2")).toBe(0);
  });

  it("reads the hidden view counter only", async () => {
    mocks.listSiteDomainPostMetaMany.mockResolvedValueOnce([
      { domainPostId: "post-1", key: VIEW_COUNT_META_KEY, value: "7" },
    ]);

    const counts = await getViewCountsByPost([
      { id: "post-1", siteId: "site-1", dataDomainKey: "post" },
    ]);

    expect(counts.get("post-1")).toBe(7);
  });
});
