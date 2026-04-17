import { beforeEach, describe, expect, it, vi } from "vitest";

const themeMocks = vi.hoisted(() => ({
  getSiteThemeId: vi.fn(),
  listThemesWithState: vi.fn(),
}));

vi.mock("@/lib/themes", () => ({
  getSiteThemeId: themeMocks.getSiteThemeId,
  listThemesWithState: themeMocks.listThemesWithState,
}));

describe("getActiveThemeForSite", () => {
  beforeEach(() => {
    vi.resetModules();
    themeMocks.getSiteThemeId.mockReset();
    themeMocks.listThemesWithState.mockReset();
  });

  it("loads theme state with the active site id", { timeout: 20_000 }, async () => {
    themeMocks.getSiteThemeId.mockResolvedValue("robert-betan-sub");
    themeMocks.listThemesWithState.mockResolvedValue([
      {
        id: "robert-betan-sub",
        name: "Robert Betan Subdomain",
        kind: "theme",
        description: "Subdomain landing theme",
        version: "1.0.0",
        minCoreVersion: "0.1.0",
        enabled: true,
        config: { hero_title: "Site Hero" },
      },
    ]);

    const { getActiveThemeForSite } = await import("@/lib/theme-runtime");
    const theme = await getActiveThemeForSite("site-circuits");

    expect(themeMocks.listThemesWithState).toHaveBeenCalledWith("site-circuits");
    expect(theme?.config.hero_title).toBe("Site Hero");
  });
});
