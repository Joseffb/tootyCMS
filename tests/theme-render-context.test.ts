import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getThemeContextApi: vi.fn(),
  createKernelForRequest: vi.fn(),
  getThemeQueryRequestsForSite: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/extension-api", () => ({
  getThemeContextApi: mocks.getThemeContextApi,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/theme-runtime", () => ({
  getThemeQueryRequestsForSite: mocks.getThemeQueryRequestsForSite,
}));

describe("theme render context", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSession.mockReset();
    mocks.getThemeContextApi.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.getThemeQueryRequestsForSite.mockReset();
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Test User",
        username: "test-user",
      },
    });
    mocks.getThemeContextApi.mockResolvedValue({
      site: { id: "site-1" },
      settings: {},
      domains: [],
      pluginSettings: {},
      query: {},
    });
    mocks.getThemeQueryRequestsForSite.mockResolvedValue([]);
  });

  it("merges generic theme slots into the tooty context and drops invalid slot values", async () => {
    const applyFilters = vi.fn().mockResolvedValue({
      comments: '  <div data-theme-slot="comments"></div>  ',
      empty: "   ",
      invalid: 42,
    });
    mocks.createKernelForRequest.mockResolvedValue({
      applyFilters,
    });

    const { getThemeRenderContext } = await import("@/lib/theme-render-context");
    const result = await getThemeRenderContext("site-1", "domain_detail", ["{{ tooty.query.foo }}"], {
      slotContext: {
        entry: { id: "entry-1" },
      },
    });

    expect(applyFilters).toHaveBeenCalledWith("theme:slots", {}, {
      siteId: "site-1",
      routeKind: "domain_detail",
      entry: { id: "entry-1" },
    });
    expect(result.tooty.slots).toEqual({
      comments: '<div data-theme-slot="comments"></div>',
    });
    expect(result.auth).toMatchObject({
      logged_in: true,
      user_id: "user-1",
      display_name: "Test User",
      username: "test-user",
    });
  });
});
