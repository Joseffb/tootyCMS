import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { getDatabaseHealthReport } from "@/lib/db-health";
import { userCan, canUserCreateDomainContent } from "@/lib/authorization";
import { inArray } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { getDashboardPluginMenuItems, createKernelForRequest } from "@/lib/plugin-runtime";
import { getAllDataDomains } from "@/lib/actions";
import { pluralizeLabel, singularizeLabel } from "@/lib/data-domain-labels";
import { hasGraphAnalyticsProvider } from "@/lib/analytics-availability";
import {
  buildAdminPluginPageContext,
  getDefaultAdminUseTypes,
  normalizeAdminUseType,
  normalizeAdminUseTypes,
} from "@/lib/admin-plugin-context";
import { ensureAllRegisteredSiteDomainTypeTables } from "@/lib/site-domain-type-tables";
import { resolveAccessibleSiteId, resolveAdminScope, resolvePrimarySite } from "@/lib/admin-site-selection";

type EnvironmentBadge = {
  show?: boolean;
  label?: string;
  environment?: "development" | "production";
};

type FloatingWidget = {
  id?: string;
  title?: string;
  content?: string;
  position?: "top-right" | "bottom-right";
  dismissSetting?: {
    pluginId?: string;
    key?: string;
    value?: unknown;
  };
};

function parseDomainSettings(rawSettings: unknown) {
  if (typeof rawSettings === "string") {
    try {
      return JSON.parse(rawSettings);
    } catch {
      return {};
    }
  }
  return rawSettings && typeof rawSettings === "object" ? rawSettings : {};
}

function emptyResponse() {
  return {
    navContext: {
      siteCount: 0,
      mainSiteId: null,
      effectiveSiteId: null,
      adminMode: "multi-site",
      activeScope: "network",
      migrationRequired: false,
      canManageNetworkSettings: false,
      canManageNetworkPlugins: false,
      canManageSiteSettings: false,
      canReadSiteAnalytics: false,
      canCreateSiteContent: false,
      sites: [],
    },
    pluginMenuItems: [],
    dataDomainItems: [],
    adminUi: {
      hasAnalyticsProviders: false,
      environmentBadge: {
        show: false,
        label: "",
        environment: "production",
      },
      use_type: "default",
      use_types: ["default"],
      page: buildAdminPluginPageContext("", null),
      floatingWidgets: [],
    },
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(emptyResponse());
  }

  const url = new URL(request.url);
  const requestedSiteId = String(url.searchParams.get("siteId") || "").trim();
  const path = String(url.searchParams.get("path") || "").trim();
  const environment = process.env.NODE_ENV === "development" ? "development" : "production";

  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  if (accessibleSiteIds.length === 0) {
    return NextResponse.json(emptyResponse());
  }

  const ownedSites = await db.query.sites.findMany({
    where: inArray(sites.id, accessibleSiteIds),
    columns: { id: true, name: true, isPrimary: true, subdomain: true },
  });
  const primary = resolvePrimarySite(ownedSites);
  const requestedOrPrimarySiteId = requestedSiteId
    ? resolveAccessibleSiteId(ownedSites, requestedSiteId)
    : null;
  const scope = resolveAdminScope({
    siteCount: ownedSites.length,
    mainSiteId: primary?.id || null,
    effectiveSiteId: requestedOrPrimarySiteId,
  });

  const dbHealth = await getDatabaseHealthReport();
  const [
    canManageNetworkSettings,
    canManageNetworkPlugins,
    canManageSiteSettings,
    canReadSiteAnalytics,
    canCreateSiteContent,
    pluginMenuItemsRaw,
  ] = await Promise.all([
    userCan("network.settings.write", session.user.id),
    userCan("network.plugins.manage", session.user.id),
    scope.effectiveSiteId
      ? userCan("site.settings.write", session.user.id, { siteId: scope.effectiveSiteId })
      : Promise.resolve(false),
    scope.effectiveSiteId
      ? userCan("site.analytics.read", session.user.id, { siteId: scope.effectiveSiteId })
      : Promise.resolve(false),
    scope.effectiveSiteId
      ? userCan("site.content.create", session.user.id, { siteId: scope.effectiveSiteId })
      : Promise.resolve(false),
    getDashboardPluginMenuItems(scope.effectiveSiteId || undefined),
  ]);

  if (scope.effectiveSiteId) {
    await ensureAllRegisteredSiteDomainTypeTables({ siteId: scope.effectiveSiteId });
  }

  const navContext = {
    siteCount: ownedSites.length,
    mainSiteId: scope.mainSiteId,
    effectiveSiteId: scope.effectiveSiteId,
    adminMode: scope.adminMode,
    activeScope: scope.activeScope,
    migrationRequired: dbHealth.migrationRequired,
    canManageNetworkSettings,
    canManageNetworkPlugins,
    canManageSiteSettings,
    canReadSiteAnalytics,
    canCreateSiteContent,
    sites: ownedSites.map((site) => ({
      id: site.id,
      name: site.name || site.subdomain || site.id,
    })),
  };

  const pluginMenuItems = Array.isArray(pluginMenuItemsRaw) ? pluginMenuItemsRaw : [];

  let dataDomainItems: Array<{
    id: string;
    label: string;
    singular: string;
    order?: number;
    listHref: string;
    addHref: string;
  }> = [];
  if (scope.effectiveSiteId && canCreateSiteContent) {
    const domains = await getAllDataDomains(scope.effectiveSiteId);
    dataDomainItems = domains
      .filter((domain: any) => {
        if (!domain.assigned || domain.isActive === false) return false;
        const parsed = parseDomainSettings(domain?.settings);
        return parsed?.showInMenu !== false;
      })
      .map((domain: any) => ({
        id: String(domain.id || ""),
        label: pluralizeLabel(domain.label),
        singular: singularizeLabel(domain.label),
        order: (() => {
          const parsed = parseDomainSettings(domain?.settings);
          const rawOrder = parsed?.menuOrder ?? parsed?.order;
          const n = Number(rawOrder);
          return Number.isFinite(n) ? n : undefined;
        })(),
        listHref: `/site/${scope.effectiveSiteId}/domain/${domain.key}`,
        addHref: `/site/${scope.effectiveSiteId}/domain/${domain.key}/create`,
      }))
      .sort((a, b) => {
        const aHasOrder = Number.isFinite(a.order);
        const bHasOrder = Number.isFinite(b.order);
        if (aHasOrder && bHasOrder && a.order !== b.order) return (a.order ?? 0) - (b.order ?? 0);
        if (aHasOrder && !bHasOrder) return -1;
        if (!aHasOrder && bHasOrder) return 1;
        return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
      });
  } else if (scope.effectiveSiteId) {
    const canAccess = await canUserCreateDomainContent(session.user.id, scope.effectiveSiteId);
    if (canAccess) {
      const domains = await getAllDataDomains(scope.effectiveSiteId);
      dataDomainItems = domains
        .filter((domain: any) => {
          if (!domain.assigned || domain.isActive === false) return false;
          const parsed = parseDomainSettings(domain?.settings);
          return parsed?.showInMenu !== false;
        })
        .map((domain: any) => ({
          id: String(domain.id || ""),
          label: pluralizeLabel(domain.label),
          singular: singularizeLabel(domain.label),
          order: undefined,
          listHref: `/site/${scope.effectiveSiteId}/domain/${domain.key}`,
          addHref: `/site/${scope.effectiveSiteId}/domain/${domain.key}/create`,
        }));
    }
  }

  const kernel = await createKernelForRequest(scope.effectiveSiteId || undefined);
  const page = buildAdminPluginPageContext(path, scope.effectiveSiteId || null);
  const hasAnalyticsProviders = scope.effectiveSiteId
    ? await hasGraphAnalyticsProvider(scope.effectiveSiteId)
    : false;

  const useTypeContext = {
    siteId: scope.effectiveSiteId || null,
    environment,
    path,
    page,
  };
  const allowedUseTypes = normalizeAdminUseTypes(
    await kernel.applyFilters<string[]>("admin:context-use-types", getDefaultAdminUseTypes(), useTypeContext),
  );
  const contextUseType = await kernel.applyFilters<string>("admin:context-use-type", "default", useTypeContext);
  const legacyUseType = await kernel.applyFilters<string>("admin:brand-use-type", contextUseType, useTypeContext);
  const useType = normalizeAdminUseType(legacyUseType, allowedUseTypes);

  const badge = await kernel.applyFilters<EnvironmentBadge | null>("admin:environment-badge", null, {
    siteId: scope.effectiveSiteId || null,
    environment,
    path,
    page,
    use_type: useType,
  });
  const widgets = await kernel.applyFilters<FloatingWidget[]>("admin:floating-widgets", [], {
    siteId: scope.effectiveSiteId || null,
    environment,
    path,
    page,
    use_type: useType,
  });

  return NextResponse.json({
    navContext,
    pluginMenuItems,
    dataDomainItems,
    adminUi: {
      hasAnalyticsProviders,
      environmentBadge: {
        show: Boolean(badge?.show),
        label: String(badge?.label || ""),
        environment: badge?.environment === "development" ? "development" : "production",
      },
      use_type: useType,
      use_types: allowedUseTypes,
      page,
      floatingWidgets: Array.isArray(widgets)
        ? widgets
            .map((widget) => ({
              id: String(widget.id || ""),
              title: String(widget.title || ""),
              content: String(widget.content || ""),
              position: widget.position === "top-right" ? "top-right" : "bottom-right",
              dismissSetting:
                widget.dismissSetting &&
                typeof widget.dismissSetting === "object" &&
                String(widget.dismissSetting.pluginId || "").trim() &&
                String(widget.dismissSetting.key || "").trim()
                  ? {
                      pluginId: String(widget.dismissSetting.pluginId || "").trim(),
                      key: String(widget.dismissSetting.key || "").trim(),
                      value: widget.dismissSetting.value,
                    }
                  : undefined,
            }))
            .filter((widget) => widget.id && widget.content)
        : [],
    },
  });
}
