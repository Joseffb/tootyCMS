import { describe, expect, it } from "vitest";

import {
  resolveAccessibleSiteId,
  resolveAdminScope,
  resolvePrimarySite,
} from "@/lib/admin-site-selection";

describe("admin site selection", () => {
  it("prefers the primary or main site when resolving a default site", () => {
    const sites = [
      { id: "site-2", isPrimary: false, subdomain: "writing" },
      { id: "site-1", isPrimary: true, subdomain: "main" },
    ];

    expect(resolvePrimarySite(sites)?.id).toBe("site-1");
  });

  it("falls back to the primary accessible site when the requested site id is stale", () => {
    const sites = [
      { id: "site-1", isPrimary: true, subdomain: "main" },
      { id: "site-2", isPrimary: false, subdomain: "writing" },
    ];

    expect(resolveAccessibleSiteId(sites, "stale-site")).toBe("site-1");
  });

  it("keeps a requested site id when it is still accessible", () => {
    const sites = [
      { id: "site-1", isPrimary: true, subdomain: "main" },
      { id: "site-2", isPrimary: false, subdomain: "writing" },
    ];

    expect(resolveAccessibleSiteId(sites, "site-2")).toBe("site-2");
  });

  it("forces single-site mode into the merged single-site scope", () => {
    expect(
      resolveAdminScope({
        siteCount: 1,
        mainSiteId: "site-1",
        effectiveSiteId: "stale-site",
      }),
    ).toEqual({
      adminMode: "single-site",
      activeScope: "merged-single-site",
      mainSiteId: "site-1",
      effectiveSiteId: "site-1",
    });
  });

  it("uses network scope when a multi-site request has no active site", () => {
    expect(
      resolveAdminScope({
        siteCount: 2,
        mainSiteId: "site-1",
        effectiveSiteId: null,
      }),
    ).toEqual({
      adminMode: "multi-site",
      activeScope: "network",
      mainSiteId: "site-1",
      effectiveSiteId: null,
    });
  });

  it("uses site scope when a multi-site request resolves an active site", () => {
    expect(
      resolveAdminScope({
        siteCount: 2,
        mainSiteId: "site-1",
        effectiveSiteId: "site-2",
      }),
    ).toEqual({
      adminMode: "multi-site",
      activeScope: "site",
      mainSiteId: "site-1",
      effectiveSiteId: "site-2",
    });
  });
});
