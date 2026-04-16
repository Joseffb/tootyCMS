import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSiteData: vi.fn(),
  getActiveThemeForSite: vi.fn(),
  getThemeAssetsForSite: vi.fn(),
  getSiteTextSetting: vi.fn(),
  getEffectiveSiteRssSettings: vi.fn(),
  getSiteUrlSettingForSite: vi.fn(),
  getSitePublicUrl: vi.fn(),
}));

vi.mock("@/lib/fetchers", () => ({
  getSiteData: mocks.getSiteData,
}));

vi.mock("@/lib/theme-runtime", () => ({
  getActiveThemeForSite: mocks.getActiveThemeForSite,
  getThemeAssetsForSite: mocks.getThemeAssetsForSite,
}));

vi.mock("@/lib/cms-config", () => ({
  getSiteTextSetting: mocks.getSiteTextSetting,
  getEffectiveSiteRssSettings: mocks.getEffectiveSiteRssSettings,
  getSiteUrlSettingForSite: mocks.getSiteUrlSettingForSite,
  SEO_META_TITLE_KEY: "seo_meta_title",
  SEO_META_DESCRIPTION_KEY: "seo_meta_description",
  SOCIAL_META_TITLE_KEY: "social_meta_title",
  SOCIAL_META_DESCRIPTION_KEY: "social_meta_description",
  SOCIAL_META_IMAGE_KEY: "social_meta_image",
}));

vi.mock("@/lib/site-url", () => ({
  getSitePublicUrl: mocks.getSitePublicUrl,
}));

vi.mock("@/lib/plugin-runtime", () => ({
  createKernelForRequest: vi.fn(),
}));

vi.mock("@/lib/menu-system", () => ({
  getSiteMenu: vi.fn(),
}));

vi.mock("@/lib/theme-cache-bust", () => ({
  getThemeCacheBustToken: vi.fn(),
  withCacheBust: vi.fn((value: string) => value),
}));

vi.mock("@/lib/admin-path", () => ({
  getAdminPathAlias: vi.fn(() => "cp"),
}));

vi.mock("@/components/frontend-auth-bridge", () => ({
  default: () => null,
}));

vi.mock("next/script", () => ({
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

describe("site layout metadata", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSiteData.mockReset();
    mocks.getActiveThemeForSite.mockReset();
    mocks.getThemeAssetsForSite.mockReset();
    mocks.getSiteTextSetting.mockReset();
    mocks.getEffectiveSiteRssSettings.mockReset();
    mocks.getSiteUrlSettingForSite.mockReset();
    mocks.getSitePublicUrl.mockReset();

    mocks.getSiteData.mockResolvedValue({
      id: "site-1",
      name: "Example Site",
      description: "Example description",
      heroSubtitle: "Latest writing from Example Site",
      image: "",
      logo: "",
      subdomain: "main",
      customDomain: "example.com",
      isPrimary: true,
    });
    mocks.getActiveThemeForSite.mockResolvedValue(null);
    mocks.getThemeAssetsForSite.mockResolvedValue({ styles: [], scripts: [] });
    mocks.getSiteTextSetting.mockResolvedValue("");
    mocks.getSiteUrlSettingForSite.mockResolvedValue({ value: "https://example.com" });
    mocks.getSitePublicUrl.mockReturnValue("https://example.com");
  });

  it("advertises the RSS feed when RSS is effectively enabled", async () => {
    mocks.getEffectiveSiteRssSettings.mockResolvedValue({
      networkEnabled: true,
      enabled: true,
      contentMode: "excerpt",
      itemsPerFeed: 10,
      includedDomainKeys: ["post"],
    });

    const { generateMetadata } = await import("@/app/[domain]/layout");
    const metadata = await generateMetadata({ params: Promise.resolve({ domain: "example.com" }) });

    expect(metadata?.alternates?.types?.["application/rss+xml"]).toBe("/feed.xml");
    expect(metadata?.metadataBase?.toString()).toBe("https://example.com/");
  });

  it("omits RSS autodiscovery when RSS is disabled", async () => {
    mocks.getEffectiveSiteRssSettings.mockResolvedValue({
      networkEnabled: false,
      enabled: true,
      contentMode: "excerpt",
      itemsPerFeed: 10,
      includedDomainKeys: ["post"],
    });

    const { generateMetadata } = await import("@/app/[domain]/layout");
    const metadata = await generateMetadata({ params: Promise.resolve({ domain: "example.com" }) });

    expect(metadata?.alternates).toBeUndefined();
  });
});
