import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSiteDataDomainByKey: vi.fn(),
  upsertSiteDataDomain: vi.fn(),
  setSiteDataDomainActivation: vi.fn(),
  ensureSiteDomainTypeTables: vi.fn(),
}));

vi.mock("@/lib/site-data-domain-registry", () => ({
  findSiteDataDomainByKey: mocks.findSiteDataDomainByKey,
  upsertSiteDataDomain: mocks.upsertSiteDataDomain,
  setSiteDataDomainActivation: mocks.setSiteDataDomainActivation,
}));

vi.mock("@/lib/site-domain-type-tables", () => ({
  ensureSiteDomainTypeTables: mocks.ensureSiteDomainTypeTables,
  siteDomainTypeMetaTableTemplate: vi.fn((key: string) => `tooty_site_{id}_domain_${key}_meta`),
  siteDomainTypeTableTemplate: vi.fn((key: string) => `tooty_site_{id}_domain_${key}`),
}));

describe("plugin content type sync", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.findSiteDataDomainByKey.mockReset();
    mocks.upsertSiteDataDomain.mockReset();
    mocks.setSiteDataDomainActivation.mockReset();
    mocks.ensureSiteDomainTypeTables.mockReset();

    mocks.findSiteDataDomainByKey.mockResolvedValue(null);
    mocks.upsertSiteDataDomain.mockImplementation(async (_siteId: string, payload: Record<string, unknown>) => ({
      id: 1,
      key: String(payload.key || ""),
      settings: {},
    }));
    mocks.setSiteDataDomainActivation.mockResolvedValue(undefined);
    mocks.ensureSiteDomainTypeTables.mockResolvedValue(undefined);
  });

  it("avoids re-upserting unchanged plugin content types for the same site", async () => {
    const { syncPluginContentTypes } = await import("@/lib/plugin-content-types");

    const registrations = [
      {
        key: "carousel",
        label: "Carousel",
        description: "Plugin-managed carousel type",
        showInMenu: false,
      },
    ];

    await syncPluginContentTypes("tooty-carousels", registrations, "site-1");
    await syncPluginContentTypes("tooty-carousels", registrations, "site-1");

    expect(mocks.upsertSiteDataDomain).toHaveBeenCalledTimes(1);
    expect(mocks.setSiteDataDomainActivation).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSiteDomainTypeTables).toHaveBeenCalledTimes(1);
  });
});
