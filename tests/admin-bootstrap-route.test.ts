import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  siteFindMany: vi.fn(),
  listSiteIdsForUser: vi.fn(),
  getDatabaseHealthReport: vi.fn(),
  userCan: vi.fn(),
  getDashboardPluginMenuItems: vi.fn(),
  getAllDataDomains: vi.fn(),
  createKernelForRequest: vi.fn(),
  hasGraphAnalyticsProvider: vi.fn(),
  ensureAllRegisteredSiteDomainTypeTables: vi.fn(),
  buildAdminPluginPageContext: vi.fn(),
  getDefaultAdminUseTypes: vi.fn(),
  normalizeAdminUseType: vi.fn(),
  normalizeAdminUseTypes: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: {
        findMany: mocks.siteFindMany,
      },
    },
  },
}));

vi.mock("@/lib/site-user-tables", () => ({
  listSiteIdsForUser: mocks.listSiteIdsForUser,
}));

vi.mock("@/lib/db-health", () => ({
  getDatabaseHealthReport: mocks.getDatabaseHealthReport,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: mocks.userCan,
  canUserCreateDomainContent: vi.fn(),
}));

vi.mock("@/lib/plugin-runtime", () => ({
  getDashboardPluginMenuItems: mocks.getDashboardPluginMenuItems,
  createKernelForRequest: mocks.createKernelForRequest,
}));

vi.mock("@/lib/actions", () => ({
  getAllDataDomains: mocks.getAllDataDomains,
}));

vi.mock("@/lib/analytics-availability", () => ({
  hasGraphAnalyticsProvider: mocks.hasGraphAnalyticsProvider,
}));

vi.mock("@/lib/admin-plugin-context", () => ({
  buildAdminPluginPageContext: mocks.buildAdminPluginPageContext,
  getDefaultAdminUseTypes: mocks.getDefaultAdminUseTypes,
  normalizeAdminUseType: mocks.normalizeAdminUseType,
  normalizeAdminUseTypes: mocks.normalizeAdminUseTypes,
}));

vi.mock("@/lib/site-domain-type-tables", () => ({
  ensureAllRegisteredSiteDomainTypeTables: mocks.ensureAllRegisteredSiteDomainTypeTables,
}));

import { GET } from "@/app/api/admin/bootstrap/route";

describe("GET /api/admin/bootstrap", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.siteFindMany.mockReset();
    mocks.listSiteIdsForUser.mockReset();
    mocks.getDatabaseHealthReport.mockReset();
    mocks.userCan.mockReset();
    mocks.getDashboardPluginMenuItems.mockReset();
    mocks.getAllDataDomains.mockReset();
    mocks.createKernelForRequest.mockReset();
    mocks.hasGraphAnalyticsProvider.mockReset();
    mocks.ensureAllRegisteredSiteDomainTypeTables.mockReset();
    mocks.buildAdminPluginPageContext.mockReset();
    mocks.getDefaultAdminUseTypes.mockReset();
    mocks.normalizeAdminUseType.mockReset();
    mocks.normalizeAdminUseTypes.mockReset();

    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listSiteIdsForUser.mockResolvedValue(["site-1"]);
    mocks.siteFindMany.mockResolvedValue([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
    ]);
    mocks.getDatabaseHealthReport.mockResolvedValue({ migrationRequired: false });
    mocks.userCan.mockResolvedValue(true);
    mocks.getDashboardPluginMenuItems.mockResolvedValue([]);
    mocks.getAllDataDomains.mockResolvedValue([]);
    mocks.hasGraphAnalyticsProvider.mockResolvedValue(false);
    mocks.buildAdminPluginPageContext.mockReturnValue({ scope: "site", siteId: "site-1" });
    mocks.getDefaultAdminUseTypes.mockReturnValue(["default"]);
    mocks.normalizeAdminUseType.mockImplementation((value: string) => value);
    mocks.normalizeAdminUseTypes.mockImplementation((value: string[]) => value);
    mocks.createKernelForRequest.mockResolvedValue({
      applyFilters: vi.fn(async (_name: string, value: unknown) => value),
    });
    mocks.ensureAllRegisteredSiteDomainTypeTables.mockResolvedValue(undefined);
  });

  it("normalizes stale requested site ids before admin bootstrap computes site-scoped context", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/bootstrap?siteId=stale-site&path=%2Fapp%2Fcp%2Fsite%2Fstale-site"),
    );

    expect(response.status).toBe(200);
    expect(mocks.userCan).toHaveBeenNthCalledWith(3, "site.settings.write", "user-1", { siteId: "site-1" });
    expect(mocks.userCan).toHaveBeenNthCalledWith(4, "site.analytics.read", "user-1", { siteId: "site-1" });
    expect(mocks.userCan).toHaveBeenNthCalledWith(5, "site.content.create", "user-1", { siteId: "site-1" });
    expect(mocks.getDashboardPluginMenuItems).toHaveBeenCalledWith("site-1");
    expect(mocks.ensureAllRegisteredSiteDomainTypeTables).toHaveBeenCalledWith({ siteId: "site-1" });
    expect(mocks.createKernelForRequest).toHaveBeenCalledWith("site-1");

    const json = await response.json();
    expect(json.navContext.adminMode).toBe("single-site");
    expect(json.navContext.activeScope).toBe("merged-single-site");
    expect(json.navContext.mainSiteId).toBe("site-1");
    expect(json.navContext.effectiveSiteId).toBe("site-1");
    expect(json.navContext.sites).toEqual([{ id: "site-1", name: "Main Site" }]);
  });

  it("returns multi-site network scope when bootstrap is requested outside a site", async () => {
    mocks.listSiteIdsForUser.mockResolvedValueOnce(["site-1", "site-2"]);
    mocks.siteFindMany.mockResolvedValueOnce([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
      { id: "site-2", name: "Blog", isPrimary: false, subdomain: "blog" },
    ]);

    const response = await GET(new Request("http://localhost/api/admin/bootstrap?path=%2Fapp%2Fcp%2Fsites"));
    const json = await response.json();

    expect(json.navContext.adminMode).toBe("multi-site");
    expect(json.navContext.activeScope).toBe("network");
    expect(json.navContext.mainSiteId).toBe("site-1");
    expect(json.navContext.effectiveSiteId).toBeNull();
  });

  it("returns multi-site site scope when bootstrap is requested for an accessible site", async () => {
    mocks.listSiteIdsForUser.mockResolvedValueOnce(["site-1", "site-2"]);
    mocks.siteFindMany.mockResolvedValueOnce([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
      { id: "site-2", name: "Blog", isPrimary: false, subdomain: "blog" },
    ]);

    const response = await GET(
      new Request("http://localhost/api/admin/bootstrap?siteId=site-2&path=%2Fapp%2Fcp%2Fsite%2Fsite-2"),
    );
    const json = await response.json();

    expect(json.navContext.adminMode).toBe("multi-site");
    expect(json.navContext.activeScope).toBe("site");
    expect(json.navContext.mainSiteId).toBe("site-1");
    expect(json.navContext.effectiveSiteId).toBe("site-2");
  });
});
