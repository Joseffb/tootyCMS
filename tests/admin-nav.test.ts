import { describe, expect, it } from "vitest";

import {
  buildGlobalSettingsNavItems,
  buildSidebarTabs,
  buildSiteSettingsNavItems,
  type AdminNavContext,
} from "@/lib/admin-nav";

function createNavContext(overrides: Partial<AdminNavContext> = {}): AdminNavContext {
  return {
    siteCount: 2,
    mainSiteId: "site-1",
    effectiveSiteId: null,
    adminMode: "multi-site",
    activeScope: "network",
    migrationRequired: false,
    canManageNetworkSettings: true,
    canManageNetworkPlugins: true,
    canManageSiteSettings: true,
    canReadSiteAnalytics: true,
    canCreateSiteContent: true,
    sites: [
      { id: "site-1", name: "Main Site" },
      { id: "site-2", name: "Blog" },
    ],
    ...overrides,
  };
}

describe("admin nav builders", () => {
  it("builds the multi-site network sidebar without site settings", () => {
    const tabs = buildSidebarTabs({
      pathname: "/app/settings/plugins",
      navContext: createNavContext(),
      currentSiteId: null,
      dataDomainTabs: [],
      hasAnalyticsProviders: false,
      pluginTabs: [],
      rootPluginTabs: [],
    });

    expect(tabs.map((tab) => tab.name)).toContain("Network Dashboard");
    expect(tabs.map((tab) => tab.name)).toContain("Sites");
    expect(tabs.map((tab) => tab.name)).toContain("Reading");
    expect(tabs.map((tab) => tab.name)).toContain("Themes");
    expect(tabs.map((tab) => tab.name)).not.toContain("General");
    expect(tabs.map((tab) => tab.name)).not.toContain("Back to All Sites");
  });

  it("builds the multi-site site sidebar without network settings injection", () => {
    const tabs = buildSidebarTabs({
      pathname: "/app/site/site-2/settings/themes",
      navContext: createNavContext({
        activeScope: "site",
        effectiveSiteId: "site-2",
      }),
      currentSiteId: "site-2",
      dataDomainTabs: [],
      hasAnalyticsProviders: true,
      pluginTabs: [],
      rootPluginTabs: [],
    });

    expect(tabs.map((tab) => tab.name)).toContain("Back to All Sites");
    expect(tabs.map((tab) => tab.name)).toContain("General");
    expect(tabs.map((tab) => tab.name)).toContain("Themes");
    expect(tabs.map((tab) => tab.name)).not.toContain("Network Dashboard");
    expect(tabs.map((tab) => tab.name)).not.toContain("User Roles");
    expect(tabs.map((tab) => tab.name)).not.toContain("Migrations");
  });

  it("builds the single-site merged sidebar from adminMode instead of recomputing from siteCount", () => {
    const tabs = buildSidebarTabs({
      pathname: "/app/settings/rbac",
      navContext: createNavContext({
        siteCount: 2,
        adminMode: "single-site",
        activeScope: "merged-single-site",
        effectiveSiteId: "site-1",
      }),
      currentSiteId: null,
      dataDomainTabs: [],
      hasAnalyticsProviders: false,
      pluginTabs: [],
      rootPluginTabs: [],
    });

    const names = tabs.map((tab) => tab.name);

    expect(names).toContain("Dashboard");
    expect(names).toContain("General");
    expect(names).toContain("User Roles");
    expect(names).toContain("Schedules");
    expect(names).toContain("Migrations");
    expect(names).not.toContain("Sites");
    expect(names).not.toContain("Network Dashboard");
    expect(names.filter((name) => name === "Themes")).toHaveLength(1);
    expect(names.filter((name) => name === "Plugins")).toHaveLength(1);
    expect(names.filter((name) => name === "Messages")).toHaveLength(1);
    expect(names.filter((name) => name === "Users")).toHaveLength(1);
  });

  it("keeps global settings routes compatible while targeting site aliases in single-site mode", () => {
    const items = buildGlobalSettingsNavItems({
      adminMode: "single-site",
      mainSiteId: "site-1",
      canManageNetworkSettings: true,
      canManageNetworkPlugins: true,
    });

    expect(items.find((item) => item.name === "Themes")?.href).toBe("/app/site/site-1/settings/themes");
    expect(items.find((item) => item.name === "User Roles")?.href).toBe("/app/site/site-1/settings/rbac");
    expect(items.find((item) => item.name === "Migrations")?.href).toBe("/app/site/site-1/settings/database");
  });

  it("builds site settings tabs with merged network items only in single-site mode", () => {
    const multiSiteItems = buildSiteSettingsNavItems({
      siteId: "site-1",
      adminMode: "multi-site",
      canManageNetworkSettings: true,
    });
    const singleSiteItems = buildSiteSettingsNavItems({
      siteId: "site-1",
      adminMode: "single-site",
      canManageNetworkSettings: true,
    });

    expect(multiSiteItems.map((item) => item.name)).not.toContain("User Roles");
    expect(singleSiteItems.map((item) => item.name)).toContain("User Roles");
    expect(singleSiteItems.map((item) => item.name)).toContain("Schedules");
    expect(singleSiteItems.map((item) => item.name)).toContain("Migrations");
  });
});
