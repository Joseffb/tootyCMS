import type { AdminMode, AdminScope } from "@/lib/admin-site-selection";

export type AdminSiteSummary = {
  id: string;
  name: string;
};

export type AdminNavContext = {
  siteCount: number;
  mainSiteId: string | null;
  effectiveSiteId: string | null;
  adminMode: AdminMode;
  activeScope: AdminScope;
  migrationRequired: boolean;
  canManageNetworkSettings: boolean;
  canManageNetworkPlugins: boolean;
  canManageSiteSettings: boolean;
  canReadSiteAnalytics: boolean;
  canCreateSiteContent: boolean;
  sites: AdminSiteSummary[];
};

export type AdminSettingsNavItem = {
  name: string;
  href: string;
  segment: string | null;
};

export type AdminSidebarIcon =
  | "back"
  | "content"
  | "dashboard"
  | "analytics"
  | "network-settings"
  | "plugin"
  | "profile"
  | "site"
  | "site-settings";

export type AdminSidebarTab = {
  name: string;
  href: string;
  isActive?: boolean;
  icon: AdminSidebarIcon;
  isChild?: boolean;
  childLevel?: 1 | 2;
};

export type AdminSidebarDataDomainTab = {
  name: string;
  singular: string;
  listHref: string;
  addHref: string;
  order?: number;
};

type SettingsDefinition = {
  name: string;
  suffix: string;
  segment: string | null;
};

const SITE_SETTINGS_DEFINITIONS: SettingsDefinition[] = [
  { name: "General", suffix: "", segment: null },
  { name: "Categories", suffix: "categories", segment: "categories" },
  { name: "Post-Types", suffix: "domains", segment: "domains" },
  { name: "Reading", suffix: "reading", segment: "reading" },
  { name: "SEO & Social", suffix: "seo", segment: "seo" },
  { name: "Writing", suffix: "writing", segment: "writing" },
  { name: "Menus", suffix: "menus", segment: "menus" },
  { name: "Themes", suffix: "themes", segment: "themes" },
  { name: "Plugins", suffix: "plugins", segment: "plugins" },
  { name: "Messages", suffix: "messages", segment: "messages" },
  { name: "Comments", suffix: "comments", segment: "comments" },
  { name: "Users", suffix: "users", segment: "users" },
];

const SINGLE_SITE_NETWORK_SETTINGS_DEFINITIONS: SettingsDefinition[] = [
  { name: "User Roles", suffix: "rbac", segment: "rbac" },
  { name: "Schedules", suffix: "schedules", segment: "schedules" },
  { name: "Migrations", suffix: "database", segment: "database" },
];

const NETWORK_SETTINGS_DEFINITIONS: SettingsDefinition[] = [
  { name: "Sites", suffix: "sites", segment: "sites" },
  { name: "Themes", suffix: "themes", segment: "themes" },
  { name: "Plugins", suffix: "plugins", segment: "plugins" },
  { name: "Messages", suffix: "messages", segment: "messages" },
  { name: "Migrations", suffix: "database", segment: "database" },
  { name: "Schedules", suffix: "schedules", segment: "schedules" },
  { name: "Users", suffix: "users", segment: "users" },
  { name: "User Roles", suffix: "rbac", segment: "rbac" },
];

const SINGLE_SITE_GLOBAL_COMPAT_SEGMENTS = new Set([
  "",
  "reading",
  "writing",
  "themes",
  "plugins",
  "messages",
  "users",
  "schedules",
  "database",
  "rbac",
]);

function joinSiteSettingsHref(siteId: string, suffix: string) {
  return suffix ? `/app/site/${siteId}/settings/${suffix}` : `/app/site/${siteId}/settings`;
}

function joinNetworkSettingsHref(suffix: string) {
  return suffix ? `/app/settings/${suffix}` : "/app/settings";
}

function isActivePath(pathname: string, candidate: string) {
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

function getSettingsActiveMatches(siteId: string, suffix: string, adminMode: AdminMode) {
  const matches = [joinSiteSettingsHref(siteId, suffix)];
  if (adminMode === "single-site" && SINGLE_SITE_GLOBAL_COMPAT_SEGMENTS.has(suffix)) {
    matches.push(joinNetworkSettingsHref(suffix));
  }
  return matches;
}

function settingsDefinitionsForMode(
  adminMode: AdminMode,
  canManageNetworkSettings: boolean,
) {
  return adminMode === "single-site"
    ? [
        ...SITE_SETTINGS_DEFINITIONS,
        ...(canManageNetworkSettings ? SINGLE_SITE_NETWORK_SETTINGS_DEFINITIONS : []),
      ]
    : SITE_SETTINGS_DEFINITIONS;
}

export function buildSiteSettingsNavItems(input: {
  siteId: string;
  adminMode: AdminMode;
  canManageNetworkSettings?: boolean;
}): AdminSettingsNavItem[] {
  const definitions = settingsDefinitionsForMode(
    input.adminMode,
    Boolean(input.canManageNetworkSettings),
  );
  return definitions.map((item) => ({
    name: item.name,
    href: joinSiteSettingsHref(input.siteId, item.suffix),
    segment: item.segment,
  }));
}

export function buildGlobalSettingsNavItems(input: {
  adminMode: AdminMode;
  mainSiteId: string | null;
  canManageNetworkSettings: boolean;
  canManageNetworkPlugins: boolean;
}): AdminSettingsNavItem[] {
  if (!input.canManageNetworkSettings) return [];
  if (input.adminMode === "single-site" && input.mainSiteId) {
    return buildSiteSettingsNavItems({
      siteId: input.mainSiteId,
      adminMode: input.adminMode,
      canManageNetworkSettings: input.canManageNetworkSettings,
    });
  }

  return NETWORK_SETTINGS_DEFINITIONS
    .filter((item) => input.canManageNetworkPlugins || item.name !== "Messages")
    .map((item) => ({
      name: item.name,
      href: joinNetworkSettingsHref(item.suffix),
      segment: item.segment,
    }));
}

function buildSettingsSidebarChildren(input: {
  items: AdminSettingsNavItem[];
  pathname: string;
  pluginTabs: Array<{ name: string; href: string }>;
  icon: AdminSidebarIcon;
  adminMode: AdminMode;
  siteId: string;
}) {
  return input.items.flatMap((item) => {
    const suffix = item.href.replace(/^\/app\/site\/[^/]+\/settings\/?/, "").replace(/^\/app\/settings\/?/, "");
    const activeMatches = getSettingsActiveMatches(input.siteId, suffix, input.adminMode);
    const base: AdminSidebarTab = {
      name: item.name,
      href: item.href,
      isActive: activeMatches.some((candidate) => isActivePath(input.pathname, candidate)),
      icon: input.icon,
      isChild: true,
      childLevel: 1,
    };
    if (item.name !== "Plugins") return [base];
    const pluginChildren: AdminSidebarTab[] = input.pluginTabs.map((plugin) => ({
      name: plugin.name,
      href: plugin.href,
      isActive: isActivePath(input.pathname, plugin.href),
      icon: input.icon,
      isChild: true,
      childLevel: 2,
    }));
    return [base, ...pluginChildren];
  });
}

function buildContentTabs(input: {
  siteId: string;
  pathname: string;
  dataDomainTabs: AdminSidebarDataDomainTab[];
}): AdminSidebarTab[] {
  const dedupedByListHref = new Map<string, AdminSidebarDataDomainTab>();
  const entries = [
    {
      name: "Posts",
      singular: "Post",
      listHref: `/app/site/${input.siteId}/domain/post`,
      addHref: `/app/site/${input.siteId}/domain/post/create`,
      order: undefined as number | undefined,
    },
    ...input.dataDomainTabs,
  ];

  for (const item of entries) {
    if (!dedupedByListHref.has(item.listHref)) {
      dedupedByListHref.set(item.listHref, item);
    }
  }

  return Array.from(dedupedByListHref.values())
    .sort((a, b) => {
      const aHasOrder = Number.isFinite(a.order);
      const bHasOrder = Number.isFinite(b.order);
      if (aHasOrder && bHasOrder) return Number(a.order) - Number(b.order);
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .flatMap((item) => [
      {
        name: item.name,
        href: item.listHref,
        isActive: isActivePath(input.pathname, item.listHref) && !isActivePath(input.pathname, item.addHref),
        icon: "content" as const,
      },
      {
        name: `List ${item.name}`,
        href: item.listHref,
        isActive: isActivePath(input.pathname, item.listHref) && !isActivePath(input.pathname, item.addHref),
        icon: "content" as const,
        isChild: true,
        childLevel: 1 as const,
      },
      {
        name: `Add ${item.singular}`,
        href: item.addHref,
        isActive: isActivePath(input.pathname, item.addHref),
        icon: "content" as const,
        isChild: true,
        childLevel: 1 as const,
      },
    ]);
}

function buildMultiSiteNetworkSidebarTabs(input: {
  pathname: string;
  navContext: AdminNavContext;
  pluginTabs: Array<{ name: string; href: string }>;
  rootPluginTabs: Array<{ name: string; href: string }>;
}) {
  const globalSettings = buildGlobalSettingsNavItems({
    adminMode: input.navContext.adminMode,
    mainSiteId: input.navContext.mainSiteId,
    canManageNetworkSettings: input.navContext.canManageNetworkSettings,
    canManageNetworkPlugins: input.navContext.canManageNetworkPlugins,
  });

  return [
    {
      name: "Profile",
      href: "/app/profile",
      isActive: isActivePath(input.pathname, "/app/profile"),
      icon: "profile" as const,
    },
    {
      name: "Network Dashboard",
      href: "/app",
      isActive: input.pathname === "/app" || input.pathname === "/app/cp",
      icon: "dashboard" as const,
    },
    {
      name: "Sites",
      href: "/app/sites",
      isActive: isActivePath(input.pathname, "/app/sites"),
      icon: "site" as const,
    },
    ...[...input.navContext.sites]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((site) => ({
        name: site.name,
        href: `/app/site/${site.id}`,
        isActive: isActivePath(input.pathname, `/app/site/${site.id}`),
        icon: "site" as const,
        isChild: true,
        childLevel: 1 as const,
      })),
    ...input.rootPluginTabs.map((plugin) => ({
      name: plugin.name,
      href: plugin.href,
      isActive: isActivePath(input.pathname, plugin.href),
      icon: "plugin" as const,
    })),
    ...(input.navContext.canManageNetworkSettings
      ? [
          {
            name: "Settings",
            href: "/app/settings",
            isActive: isActivePath(input.pathname, "/app/settings"),
            icon: "network-settings" as const,
          },
          ...buildSettingsSidebarChildren({
            items: globalSettings,
            pathname: input.pathname,
            pluginTabs: input.pluginTabs,
            icon: "network-settings",
            adminMode: input.navContext.adminMode,
            siteId: input.navContext.mainSiteId || "",
          }),
        ]
      : []),
  ];
}

function buildMultiSiteSiteSidebarTabs(input: {
  pathname: string;
  siteId: string;
  navContext: AdminNavContext;
  dataDomainTabs: AdminSidebarDataDomainTab[];
  hasAnalyticsProviders: boolean;
  pluginTabs: Array<{ name: string; href: string }>;
  rootPluginTabs: Array<{ name: string; href: string }>;
}) {
  const siteSettings = buildSiteSettingsNavItems({
    siteId: input.siteId,
    adminMode: input.navContext.adminMode,
    canManageNetworkSettings: input.navContext.canManageNetworkSettings,
  });

  return [
    {
      name: "Dashboard",
      href: `/app/site/${input.siteId}`,
      isActive:
        input.pathname === `/app/site/${input.siteId}` ||
        input.pathname === `/app/site/${input.siteId}/domain` ||
        input.pathname.startsWith(`/app/site/${input.siteId}/domain/`),
      icon: "dashboard" as const,
    },
    {
      name: "Back to All Sites",
      href: "/app/sites",
      isActive: false,
      icon: "back" as const,
      isChild: true,
      childLevel: 1 as const,
    },
    {
      name: "Profile",
      href: "/app/profile",
      isActive: isActivePath(input.pathname, "/app/profile"),
      icon: "profile" as const,
    },
    ...(input.navContext.canCreateSiteContent
      ? buildContentTabs({
          siteId: input.siteId,
          pathname: input.pathname,
          dataDomainTabs: input.dataDomainTabs,
        })
      : []),
    ...(input.hasAnalyticsProviders && input.navContext.canReadSiteAnalytics
      ? [
          {
            name: "Analytics",
            href: `/app/site/${input.siteId}/analytics`,
            isActive: isActivePath(input.pathname, `/app/site/${input.siteId}/analytics`),
            icon: "analytics" as const,
          },
        ]
      : []),
    ...input.rootPluginTabs.map((plugin) => ({
      name: plugin.name,
      href: plugin.href,
      isActive: isActivePath(input.pathname, plugin.href),
      icon: "plugin" as const,
    })),
    ...(input.navContext.canManageSiteSettings
      ? [
          {
            name: "Settings",
            href: `/app/site/${input.siteId}/settings`,
            isActive: isActivePath(input.pathname, `/app/site/${input.siteId}/settings`),
            icon: "site-settings" as const,
          },
          ...buildSettingsSidebarChildren({
            items: siteSettings,
            pathname: input.pathname,
            pluginTabs: input.pluginTabs,
            icon: "site-settings",
            adminMode: input.navContext.adminMode,
            siteId: input.siteId,
          }),
        ]
      : []),
  ];
}

function buildSingleSiteMergedSidebarTabs(input: {
  pathname: string;
  siteId: string;
  navContext: AdminNavContext;
  dataDomainTabs: AdminSidebarDataDomainTab[];
  hasAnalyticsProviders: boolean;
  pluginTabs: Array<{ name: string; href: string }>;
  rootPluginTabs: Array<{ name: string; href: string }>;
}) {
  const mergedSettings = buildSiteSettingsNavItems({
    siteId: input.siteId,
    adminMode: input.navContext.adminMode,
    canManageNetworkSettings: input.navContext.canManageNetworkSettings,
  });

  return [
    {
      name: "Dashboard",
      href: `/app/site/${input.siteId}`,
      isActive:
        input.pathname === `/app/site/${input.siteId}` ||
        input.pathname === "/app" ||
        input.pathname === "/app/cp" ||
        input.pathname === "/app/sites" ||
        input.pathname.startsWith(`/app/site/${input.siteId}/domain`) ||
        input.pathname.startsWith("/app/settings"),
      icon: "dashboard" as const,
    },
    {
      name: "Profile",
      href: "/app/profile",
      isActive: isActivePath(input.pathname, "/app/profile"),
      icon: "profile" as const,
    },
    ...(input.navContext.canCreateSiteContent
      ? buildContentTabs({
          siteId: input.siteId,
          pathname: input.pathname,
          dataDomainTabs: input.dataDomainTabs,
        })
      : []),
    ...(input.hasAnalyticsProviders && input.navContext.canReadSiteAnalytics
      ? [
          {
            name: "Analytics",
            href: `/app/site/${input.siteId}/analytics`,
            isActive: isActivePath(input.pathname, `/app/site/${input.siteId}/analytics`),
            icon: "analytics" as const,
          },
        ]
      : []),
    ...input.rootPluginTabs.map((plugin) => ({
      name: plugin.name,
      href: plugin.href,
      isActive: isActivePath(input.pathname, plugin.href),
      icon: "plugin" as const,
    })),
    ...(input.navContext.canManageSiteSettings
      ? [
          {
            name: "Settings",
            href: `/app/site/${input.siteId}/settings`,
            isActive:
              isActivePath(input.pathname, `/app/site/${input.siteId}/settings`) ||
              isActivePath(input.pathname, "/app/settings"),
            icon: "site-settings" as const,
          },
          ...buildSettingsSidebarChildren({
            items: mergedSettings,
            pathname: input.pathname,
            pluginTabs: input.pluginTabs,
            icon: "site-settings",
            adminMode: input.navContext.adminMode,
            siteId: input.siteId,
          }),
        ]
      : []),
  ];
}

export function buildSidebarTabs(input: {
  pathname: string;
  navContext: AdminNavContext;
  currentSiteId: string | null;
  dataDomainTabs: AdminSidebarDataDomainTab[];
  hasAnalyticsProviders: boolean;
  pluginTabs: Array<{ name: string; href: string }>;
  rootPluginTabs: Array<{ name: string; href: string }>;
}): AdminSidebarTab[] {
  if (input.navContext.adminMode === "single-site" && input.navContext.mainSiteId) {
    return buildSingleSiteMergedSidebarTabs({
      pathname: input.pathname,
      siteId: input.navContext.mainSiteId,
      navContext: input.navContext,
      dataDomainTabs: input.dataDomainTabs,
      hasAnalyticsProviders: input.hasAnalyticsProviders,
      pluginTabs: input.pluginTabs,
      rootPluginTabs: input.rootPluginTabs,
    });
  }

  if (input.navContext.activeScope === "site" && input.currentSiteId) {
    return buildMultiSiteSiteSidebarTabs({
      pathname: input.pathname,
      siteId: input.currentSiteId,
      navContext: input.navContext,
      dataDomainTabs: input.dataDomainTabs,
      hasAnalyticsProviders: input.hasAnalyticsProviders,
      pluginTabs: input.pluginTabs,
      rootPluginTabs: input.rootPluginTabs,
    });
  }

  return buildMultiSiteNetworkSidebarTabs({
    pathname: input.pathname,
    navContext: input.navContext,
    pluginTabs: input.pluginTabs,
    rootPluginTabs: input.rootPluginTabs,
  });
}
