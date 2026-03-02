import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  deleteSettingsByKeys: vi.fn(),
  getSettingByKey: vi.fn(),
  getSettingsByKeys: vi.fn(),
  listSettingsByLikePatterns: vi.fn(),
  setSettingByKey: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn(async () => ["robert-betan-sub"]),
  readFile: vi.fn(async () =>
    JSON.stringify({
      kind: "theme",
      id: "robert-betan-sub",
      name: "Robert Betan Subdomain",
      description: "Subdomain landing theme",
      version: "1.0.0",
      minCoreVersion: "0.1.0",
      settingsFields: [
        { key: "hero_title", label: "Hero Title", type: "text", defaultValue: "Default Hero" },
        { key: "hero_subtitle", label: "Hero Subtitle", type: "textarea", defaultValue: "Default Subtitle" },
      ],
    }),
  ),
}));

vi.mock("@/lib/extension-paths", () => ({
  getThemesDirs: () => ["/virtual/themes"],
}));

vi.mock("@/lib/settings-store", () => ({
  deleteSettingsByKeys: settingsMocks.deleteSettingsByKeys,
  getSettingByKey: settingsMocks.getSettingByKey,
  getSettingsByKeys: settingsMocks.getSettingsByKeys,
  listSettingsByLikePatterns: settingsMocks.listSettingsByLikePatterns,
  setSettingByKey: settingsMocks.setSettingByKey,
}));

describe("theme config scoping", () => {
  beforeEach(() => {
    vi.resetModules();
    settingsMocks.deleteSettingsByKeys.mockReset();
    settingsMocks.getSettingByKey.mockReset();
    settingsMocks.getSettingsByKeys.mockReset();
    settingsMocks.listSettingsByLikePatterns.mockReset();
    settingsMocks.setSettingByKey.mockReset();
    settingsMocks.listSettingsByLikePatterns.mockResolvedValue([]);
  });

  it("layers site-scoped overrides on top of network theme defaults", async () => {
    settingsMocks.getSettingsByKeys.mockResolvedValue({
      "theme_robert-betan-sub_enabled": "true",
      "theme_robert-betan-sub_config": JSON.stringify({
        hero_title: "Network Hero",
        hero_subtitle: "Network Subtitle",
      }),
      "site_site-a_theme_robert-betan-sub_config": JSON.stringify({
        hero_title: "Site A Hero",
      }),
    });

    const { listThemesWithState } = await import("@/lib/themes");
    const [theme] = await listThemesWithState("site-a");

    expect(theme?.config.hero_title).toBe("Site A Hero");
    expect(theme?.config.hero_subtitle).toBe("Network Subtitle");
  });

  it("does not leak one site's theme config into another site", async () => {
    settingsMocks.getSettingsByKeys.mockResolvedValue({
      "theme_robert-betan-sub_enabled": "true",
      "theme_robert-betan-sub_config": JSON.stringify({
        hero_title: "Network Hero",
      }),
      "site_site-a_theme_robert-betan-sub_config": JSON.stringify({
        hero_title: "Site A Hero",
      }),
    });

    const { listThemesWithState } = await import("@/lib/themes");
    const [theme] = await listThemesWithState("site-b");

    expect(theme?.config.hero_title).toBe("Network Hero");
  });
});
