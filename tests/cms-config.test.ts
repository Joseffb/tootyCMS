import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingByKey: vi.fn(),
  listSiteDataDomains: vi.fn(),
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingByKey: mocks.getSettingByKey,
  setSettingByKey: vi.fn(),
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  listSiteDataDomains: mocks.listSiteDataDomains,
}));

const settingsByKey = new Map<string, string | undefined>();
let activeDomains: Array<{ key: string; isActive?: boolean }> = [];

describe("site-scoped settings", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSettingByKey.mockReset();
    mocks.listSiteDataDomains.mockReset();
    settingsByKey.clear();
    activeDomains = [];
    mocks.getSettingByKey.mockImplementation(async (key: string) => settingsByKey.get(key));
    mocks.listSiteDataDomains.mockImplementation(async () => activeDomains);
  });

  it("returns fallback text when the site is deleted mid-request", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("Invalid site."));

    const { getSiteTextSetting } = await import("@/lib/cms-config");
    await expect(getSiteTextSetting("missing-site", "seo_meta_title", "fallback")).resolves.toBe(
      "fallback",
    );
  });

  it("returns fallback boolean when the site is deleted mid-request", async () => {
    mocks.getSettingByKey.mockRejectedValue(new Error("Invalid site."));

    const { getSiteBooleanSetting } = await import("@/lib/cms-config");
    await expect(getSiteBooleanSetting("missing-site", "main_header_enabled", true)).resolves.toBe(
      true,
    );
  });

  it("applies network RSS defaults when a site has no overrides", async () => {
    settingsByKey.set("rss_network_enabled", "true");
    settingsByKey.set("rss_default_enabled", "false");
    settingsByKey.set("rss_default_content_mode", "full");
    settingsByKey.set("rss_default_items_per_feed", "25");
    activeDomains = [
      { key: "post", isActive: true },
      { key: "page", isActive: true },
    ];

    const { getEffectiveSiteRssSettings } = await import("@/lib/cms-config");
    await expect(getEffectiveSiteRssSettings("site-1")).resolves.toMatchObject({
      networkEnabled: true,
      enabled: false,
      contentMode: "full",
      itemsPerFeed: 25,
      includedDomainKeys: ["post"],
    });
  });

  it("reports RSS as unavailable when the network master switch is off", async () => {
    settingsByKey.set("rss_network_enabled", "false");
    settingsByKey.set("site_site-1_rss_enabled", "true");
    activeDomains = [{ key: "post", isActive: true }];

    const { getEffectiveSiteRssSettings } = await import("@/lib/cms-config");
    await expect(getEffectiveSiteRssSettings("site-1")).resolves.toMatchObject({
      networkEnabled: false,
      enabled: true,
    });
  });

  it("clamps RSS item counts to allowed bounds", async () => {
    settingsByKey.set("rss_default_items_per_feed", "500");
    settingsByKey.set("site_site-1_rss_items_per_feed", "0");
    activeDomains = [{ key: "post", isActive: true }];

    const { getRssSettings, getEffectiveSiteRssSettings } = await import("@/lib/cms-config");
    await expect(getRssSettings()).resolves.toMatchObject({ itemsPerFeed: 100 });
    await expect(getEffectiveSiteRssSettings("site-1")).resolves.toMatchObject({ itemsPerFeed: 1 });
  });

  it("ignores stale RSS included domains and keeps active ones", async () => {
    settingsByKey.set("site_site-1_rss_include_domain_keys", "post,showcase,stale-domain");
    activeDomains = [
      { key: "post", isActive: true },
      { key: "showcase", isActive: true },
    ];

    const { getEffectiveSiteRssSettings } = await import("@/lib/cms-config");
    await expect(getEffectiveSiteRssSettings("site-1")).resolves.toMatchObject({
      includedDomainKeys: ["post", "showcase"],
    });
  });

  it("falls back to post when RSS included domains resolve to an empty set", async () => {
    settingsByKey.set("site_site-1_rss_include_domain_keys", "stale-domain");
    activeDomains = [];

    const { getEffectiveSiteRssSettings } = await import("@/lib/cms-config");
    await expect(getEffectiveSiteRssSettings("site-1")).resolves.toMatchObject({
      includedDomainKeys: ["post"],
    });
  });
});
