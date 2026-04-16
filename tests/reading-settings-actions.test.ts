import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbMock,
  getSessionMock,
  userCanMock,
  siteDomainRegistry,
  settingsStoreMocks,
  revalidatePathMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  dbMock: {
    query: {
      sites: {
        findFirst: vi.fn(async () => ({
          id: "site-1",
          userId: "user-1",
          subdomain: "main",
          customDomain: "example.com",
          isPrimary: true,
          name: "Example Site",
          description: "Example description",
          heroSubtitle: "Latest writing from Example Site",
          image: "",
          logo: "",
        })),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(async () => []),
    })),
  },
  getSessionMock: vi.fn(async () => ({ user: { id: "user-1" } })),
  userCanMock: vi.fn(async () => true),
  siteDomainRegistry: {
    ensureSiteDataDomainTable: vi.fn(async () => undefined),
    listSiteDataDomains: vi.fn(async () => [
      { key: "post", label: "Post", isActive: true },
      { key: "page", label: "Page", isActive: true },
      { key: "showcase", label: "Showcase", isActive: true },
    ]),
    upsertSiteDataDomain: vi.fn(),
    findSiteDataDomainById: vi.fn(),
    findSiteDataDomainByKey: vi.fn(),
    setSiteDataDomainActivation: vi.fn(),
    updateSiteDataDomainById: vi.fn(),
    deleteSiteDataDomainById: vi.fn(),
  },
  settingsStoreMocks: {
    getSettingByKey: vi.fn(async () => undefined),
    getSettingsByKeys: vi.fn(async () => ({})),
    listSettingsByLikePatterns: vi.fn(async () => []),
    setSettingByKey: vi.fn(async () => undefined),
  },
  revalidatePathMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: dbMock,
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  withSiteAuth: (handler: unknown) => handler,
}));

vi.mock("@/lib/authorization", () => ({
  canUserMutateDomainPost: vi.fn(),
  userCan: userCanMock,
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  ensureSiteDataDomainTable: siteDomainRegistry.ensureSiteDataDomainTable,
  listSiteDataDomains: siteDomainRegistry.listSiteDataDomains,
  upsertSiteDataDomain: siteDomainRegistry.upsertSiteDataDomain,
  findSiteDataDomainById: siteDomainRegistry.findSiteDataDomainById,
  findSiteDataDomainByKey: siteDomainRegistry.findSiteDataDomainByKey,
  setSiteDataDomainActivation: siteDomainRegistry.setSiteDataDomainActivation,
  updateSiteDataDomainById: siteDomainRegistry.updateSiteDataDomainById,
  deleteSiteDataDomainById: siteDomainRegistry.deleteSiteDataDomainById,
}));

vi.mock("@/lib/settings-store", () => ({
  getSettingByKey: settingsStoreMocks.getSettingByKey,
  getSettingsByKeys: settingsStoreMocks.getSettingsByKeys,
  listSettingsByLikePatterns: settingsStoreMocks.listSettingsByLikePatterns,
  setSettingByKey: settingsStoreMocks.setSettingByKey,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

describe("reading settings actions", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.query.sites.findFirst.mockClear();
    getSessionMock.mockClear();
    userCanMock.mockClear();
    siteDomainRegistry.listSiteDataDomains.mockClear();
    settingsStoreMocks.getSettingByKey.mockClear();
    settingsStoreMocks.getSettingsByKeys.mockClear();
    settingsStoreMocks.listSettingsByLikePatterns.mockClear();
    settingsStoreMocks.setSettingByKey.mockClear();
    revalidatePathMock.mockClear();
    revalidateTagMock.mockClear();
  });

  it("saves network RSS defaults from reading settings", async () => {
    const formData = new FormData();
    formData.set("random_default_images_enabled", "on");
    formData.set("seo_indexing_enabled", "on");
    formData.set("main_header_enabled", "on");
    formData.set("main_header_show_network_sites", "on");
    formData.set("rss_network_enabled", "on");
    formData.set("rss_default_enabled", "on");
    formData.set("rss_default_content_mode", "full");
    formData.set("rss_default_items_per_feed", "25");
    formData.set("site_url", "https://example.com");
    formData.set("seo_meta_title", "Example");
    formData.set("seo_meta_description", "Example description");

    const { updateReadingSettings } = await import("@/lib/actions");
    await updateReadingSettings(formData);

    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("rss_network_enabled", "true");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("rss_default_enabled", "true");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("rss_default_content_mode", "full");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("rss_default_items_per_feed", "25");
  });

  it("saves site RSS overrides and filters included domains", async () => {
    const formData = new FormData();
    formData.set("siteId", "site-1");
    formData.set("random_default_images_enabled", "on");
    formData.set("main_header_enabled", "on");
    formData.set("main_header_show_network_sites", "on");
    formData.set("writing_permalink_mode", "custom");
    formData.set("writing_single_pattern", "/updates/%slug%");
    formData.set("writing_list_pattern", "/updates");
    formData.set("writing_no_domain_prefix", "");
    formData.set("writing_no_domain_data_domain", "post");
    formData.set("rss_enabled", "on");
    formData.set("rss_content_mode", "full");
    formData.set("rss_items_per_feed", "15");
    formData.append("rss_include_domain_keys", "post");
    formData.append("rss_include_domain_keys", "showcase");
    formData.append("rss_include_domain_keys", "stale-domain");

    const { updateSiteReadingSettings } = await import("@/lib/actions");
    await updateSiteReadingSettings(formData);

    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("site_site-1_rss_enabled", "true");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("site_site-1_rss_content_mode", "full");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("site_site-1_rss_items_per_feed", "15");
    expect(settingsStoreMocks.setSettingByKey).toHaveBeenCalledWith("site_site-1_rss_include_domain_keys", "post,showcase");
  });

  it("leaves site RSS overrides untouched when RSS controls are not submitted", async () => {
    const formData = new FormData();
    formData.set("siteId", "site-1");
    formData.set("random_default_images_enabled", "on");
    formData.set("main_header_enabled", "on");
    formData.set("main_header_show_network_sites", "on");

    const { updateSiteReadingSettings } = await import("@/lib/actions");
    await updateSiteReadingSettings(formData);

    const savedKeys = settingsStoreMocks.setSettingByKey.mock.calls.map((call) => String(call[0]));
    expect(savedKeys).not.toContain("site_site-1_rss_enabled");
    expect(savedKeys).not.toContain("site_site-1_rss_content_mode");
    expect(savedKeys).not.toContain("site_site-1_rss_items_per_feed");
    expect(savedKeys).not.toContain("site_site-1_rss_include_domain_keys");
  });
});
