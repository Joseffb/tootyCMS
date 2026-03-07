import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  siteFindMany: vi.fn(),
  listSiteIdsForUser: vi.fn(),
  getDatabaseHealthReport: vi.fn(),
  userCan: vi.fn(),
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
}));

import { GET } from "@/app/api/nav/context/route";

describe("GET /api/nav/context", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.siteFindMany.mockReset();
    mocks.listSiteIdsForUser.mockReset();
    mocks.getDatabaseHealthReport.mockReset();
    mocks.userCan.mockReset();

    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listSiteIdsForUser.mockResolvedValue(["site-1"]);
    mocks.siteFindMany.mockResolvedValue([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
    ]);
    mocks.getDatabaseHealthReport.mockResolvedValue({ migrationRequired: false });
    mocks.userCan.mockResolvedValue(true);
  });

  it("normalizes stale requested site ids back to the current accessible primary site", async () => {
    const response = await GET(
      new Request("http://localhost/api/nav/context?siteId=stale-site"),
    );

    expect(response.status).toBe(200);
    expect(mocks.userCan).toHaveBeenNthCalledWith(3, "site.settings.write", "user-1", { siteId: "site-1" });
    expect(mocks.userCan).toHaveBeenNthCalledWith(4, "site.analytics.read", "user-1", { siteId: "site-1" });
    expect(mocks.userCan).toHaveBeenNthCalledWith(5, "site.content.create", "user-1", { siteId: "site-1" });

    const json = await response.json();
    expect(json.adminMode).toBe("single-site");
    expect(json.activeScope).toBe("merged-single-site");
    expect(json.mainSiteId).toBe("site-1");
    expect(json.effectiveSiteId).toBe("site-1");
    expect(json.sites).toEqual([{ id: "site-1", name: "Main Site" }]);
  });

  it("returns multi-site network scope when no site id is requested", async () => {
    mocks.listSiteIdsForUser.mockResolvedValueOnce(["site-1", "site-2"]);
    mocks.siteFindMany.mockResolvedValueOnce([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
      { id: "site-2", name: "Blog", isPrimary: false, subdomain: "blog" },
    ]);

    const response = await GET(new Request("http://localhost/api/nav/context"));
    const json = await response.json();

    expect(json.adminMode).toBe("multi-site");
    expect(json.activeScope).toBe("network");
    expect(json.mainSiteId).toBe("site-1");
    expect(json.effectiveSiteId).toBeNull();
  });

  it("returns multi-site site scope when a valid site id is requested", async () => {
    mocks.listSiteIdsForUser.mockResolvedValueOnce(["site-1", "site-2"]);
    mocks.siteFindMany.mockResolvedValueOnce([
      { id: "site-1", name: "Main Site", isPrimary: true, subdomain: "main" },
      { id: "site-2", name: "Blog", isPrimary: false, subdomain: "blog" },
    ]);

    const response = await GET(new Request("http://localhost/api/nav/context?siteId=site-2"));
    const json = await response.json();

    expect(json.adminMode).toBe("multi-site");
    expect(json.activeScope).toBe("site");
    expect(json.mainSiteId).toBe("site-1");
    expect(json.effectiveSiteId).toBe("site-2");
  });
});
