import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDashboardPluginMenuItems: vi.fn(),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  getDashboardPluginMenuItems: mocks.getDashboardPluginMenuItems,
}));

describe("GET /api/plugins/menu", () => {
  beforeEach(() => {
    mocks.getDashboardPluginMenuItems.mockReset();
  });

  it("falls back to global plugin items when the provided site is invalid", async () => {
    mocks.getDashboardPluginMenuItems
      .mockRejectedValueOnce(new Error("Invalid site."))
      .mockResolvedValueOnce([{ label: "Carousels", href: "/plugins/tooty-carousels" }]);

    const { GET } = await import("@/app/api/plugins/menu/route");
    const res = await GET(new NextRequest("http://localhost/api/plugins/menu?siteId=bad-site"));
    const json = await res.json();

    expect(mocks.getDashboardPluginMenuItems).toHaveBeenNthCalledWith(1, "bad-site");
    expect(mocks.getDashboardPluginMenuItems).toHaveBeenNthCalledWith(2);
    expect(json.items).toEqual([{ label: "Carousels", href: "/plugins/tooty-carousels" }]);
  });
});
