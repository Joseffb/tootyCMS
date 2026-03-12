import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listPluginsWithState: vi.fn(),
  createKernelForRequest: vi.fn(),
  userCan: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  listPluginsWithState: mocks.listPluginsWithState,
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
}));

import { GET } from "@/app/api/plugins/editor/route";

describe("/api/plugins/editor", () => {
  afterEach(() => {
    mocks.getSession.mockReset();
    mocks.listPluginsWithState.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.userCan.mockReset();
  });

  it("returns ordered plugin tabs for the current domain and honors capability gates", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listPluginsWithState.mockResolvedValue([
      {
        id: "tooty-story-teller",
        name: "Tooty Story Teller",
        enabled: true,
        editor: {
          tabs: [
            {
              id: "story",
              label: "Story",
              order: 320,
              supportsDomains: ["post"],
              requiresCapability: "site.content.edit.any",
              sections: [{ id: "overview", title: "Overview", fields: [{ key: "story_enabled", label: "Enable", type: "checkbox" }] }],
            },
          ],
          snippets: [],
        },
      },
      {
        id: "page-only-plugin",
        name: "Page Only",
        enabled: true,
        editor: {
          tabs: [
            {
              id: "page-tab",
              label: "Page Tab",
              order: 100,
              supportsDomains: ["page"],
              sections: [{ id: "only", title: "Only", fields: [{ key: "x", label: "X", type: "text" }] }],
            },
          ],
          snippets: [],
        },
      },
    ]);
    mocks.createKernelForRequest.mockResolvedValue({
      applyFilters: vi.fn(async (_hook: string, current: unknown) => current),
    });
    mocks.userCan.mockResolvedValue(true);

    const response = await GET(
      new Request("http://localhost/api/plugins/editor?siteId=site-1&postId=post-1&dataDomainKey=post"),
    );
    const json = await response.json();

    expect(json.tabs).toEqual([
      expect.objectContaining({
        id: "story",
        pluginId: "tooty-story-teller",
        order: 320,
      }),
    ]);
  });
});
