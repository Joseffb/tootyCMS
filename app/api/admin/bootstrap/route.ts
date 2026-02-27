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
import { listPluginsWithSiteState, listPluginsWithState } from "@/lib/plugins";
import {
  buildAdminPluginPageContext,
  getDefaultAdminUseTypes,
  normalizeAdminUseType,
  normalizeAdminUseTypes,
} from "@/lib/admin-plugin-context";

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

function emptyResponse() {
  return {
    navContext: {
      siteCount: 0,
      mainSiteId: null,
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
  const primary =
    ownedSites.find((site) => site.isPrimary || site.subdomain === "main") ||
    ownedSites[0] ||
    null;
  const effectiveSiteId = requestedSiteId || primary?.id || "";

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
    effectiveSiteId
      ? userCan("site.settings.write", session.user.id, { siteId: effectiveSiteId })
      : Promise.resolve(false),
    effectiveSiteId
      ? userCan("site.analytics.read", session.user.id, { siteId: effectiveSiteId })
      : Promise.resolve(false),
    effectiveSiteId
      ? userCan("site.content.create", session.user.id, { siteId: effectiveSiteId })
      : Promise.resolve(false),
    getDashboardPluginMenuItems(effectiveSiteId || undefined),
  ]);

  const navContext = {
    siteCount: ownedSites.length,
    mainSiteId: primary?.id || null,
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
  if (effectiveSiteId && canCreateSiteContent) {
    const domains = await getAllDataDomains(effectiveSiteId);
    dataDomainItems = domains
      .filter((domain: any) => domain.assigned && domain.isActive !== false)
      .map((domain: any) => ({
        id: String(domain.id || ""),
        label: pluralizeLabel(domain.label),
        singular: singularizeLabel(domain.label),
        order: (() => {
          const rawSettings = domain?.settings;
          const parsed = typeof rawSettings === "string"
            ? (() => {
                try {
                  return JSON.parse(rawSettings);
                } catch {
                  return {};
                }
              })()
            : (rawSettings || {});
          const rawOrder = parsed?.menuOrder ?? parsed?.order;
          const n = Number(rawOrder);
          return Number.isFinite(n) ? n : undefined;
        })(),
        listHref: `/site/${effectiveSiteId}/domain/${domain.key}`,
        addHref: `/site/${effectiveSiteId}/domain/${domain.key}/create`,
      }))
      .sort((a, b) => {
        const aHasOrder = Number.isFinite(a.order);
        const bHasOrder = Number.isFinite(b.order);
        if (aHasOrder && bHasOrder && a.order !== b.order) return (a.order ?? 0) - (b.order ?? 0);
        if (aHasOrder && !bHasOrder) return -1;
        if (!aHasOrder && bHasOrder) return 1;
        return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
      });
  } else if (effectiveSiteId) {
    const canAccess = await canUserCreateDomainContent(session.user.id, effectiveSiteId);
    if (canAccess) {
      const domains = await getAllDataDomains(effectiveSiteId);
      dataDomainItems = domains
        .filter((domain: any) => domain.assigned && domain.isActive !== false)
        .map((domain: any) => ({
          id: String(domain.id || ""),
          label: pluralizeLabel(domain.label),
          singular: singularizeLabel(domain.label),
          order: undefined,
          listHref: `/site/${effectiveSiteId}/domain/${domain.key}`,
          addHref: `/site/${effectiveSiteId}/domain/${domain.key}/create`,
        }));
    }
  }

  const kernel = await createKernelForRequest(effectiveSiteId || undefined);
  const page = buildAdminPluginPageContext(path, effectiveSiteId || null);
  const pluginStates = effectiveSiteId
    ? await listPluginsWithSiteState(effectiveSiteId)
    : await listPluginsWithState();
  const hasAnalyticsProviders = pluginStates.some((plugin: any) => {
    const isAnalytics = String(plugin?.id || "").startsWith("analytics-");
    if (!isAnalytics) return false;
    return effectiveSiteId
      ? Boolean(plugin?.enabled && plugin?.siteEnabled)
      : Boolean(plugin?.enabled);
  });

  const useTypeContext = {
    siteId: effectiveSiteId || null,
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
    siteId: effectiveSiteId || null,
    environment,
    path,
    page,
    use_type: useType,
  });
  const widgets = await kernel.applyFilters<FloatingWidget[]>("admin:floating-widgets", [], {
    siteId: effectiveSiteId || null,
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
