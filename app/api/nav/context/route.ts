import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { getDatabaseHealthReport } from "@/lib/db-health";
import { userCan } from "@/lib/authorization";
import { inArray } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { resolveAccessibleSiteId, resolveAdminScope, resolvePrimarySite } from "@/lib/admin-site-selection";

function emptyResponse() {
  return {
    siteCount: 0,
    mainSiteId: null,
    effectiveSiteId: null,
    adminMode: "multi-site" as const,
    activeScope: "network" as const,
    sites: [],
    migrationRequired: false,
    canManageNetworkSettings: false,
    canManageNetworkPlugins: false,
    canManageSiteSettings: false,
    canReadSiteAnalytics: false,
    canCreateSiteContent: false,
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(emptyResponse());
  }
  const { searchParams } = new URL(request.url);
  const requestedSiteId = String(searchParams.get("siteId") || "").trim();
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
  const [canManageNetworkSettings, canManageNetworkPlugins, canManageSiteSettings, canReadSiteAnalytics, canCreateSiteContent] = await Promise.all([
    userCan("network.settings.write", session.user.id),
    userCan("network.plugins.manage", session.user.id),
    scope.effectiveSiteId ? userCan("site.settings.write", session.user.id, { siteId: scope.effectiveSiteId }) : Promise.resolve(false),
    scope.effectiveSiteId ? userCan("site.analytics.read", session.user.id, { siteId: scope.effectiveSiteId }) : Promise.resolve(false),
    scope.effectiveSiteId ? userCan("site.content.create", session.user.id, { siteId: scope.effectiveSiteId }) : Promise.resolve(false),
  ]);

  return NextResponse.json({
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
  });
}
