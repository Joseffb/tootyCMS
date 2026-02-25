import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { getDatabaseHealthReport } from "@/lib/db-health";
import { userCan } from "@/lib/authorization";
import { inArray } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { listSiteIdsForUser } from "@/lib/site-user-tables";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({
      siteCount: 0,
      mainSiteId: null,
      sites: [],
      migrationRequired: false,
      canManageNetworkSettings: false,
      canManageNetworkPlugins: false,
      canManageSiteSettings: false,
      canReadSiteAnalytics: false,
      canCreateSiteContent: false,
    });
  }
  const { searchParams } = new URL(request.url);
  const requestedSiteId = String(searchParams.get("siteId") || "").trim();
  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  if (accessibleSiteIds.length === 0) {
    return NextResponse.json({
      siteCount: 0,
      mainSiteId: null,
      sites: [],
      migrationRequired: false,
      canManageNetworkSettings: false,
      canManageNetworkPlugins: false,
      canManageSiteSettings: false,
      canReadSiteAnalytics: false,
      canCreateSiteContent: false,
    });
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
  const [canManageNetworkSettings, canManageNetworkPlugins, canManageSiteSettings, canReadSiteAnalytics, canCreateSiteContent] = await Promise.all([
    userCan("network.settings.write", session.user.id),
    userCan("network.plugins.manage", session.user.id),
    effectiveSiteId ? userCan("site.settings.write", session.user.id, { siteId: effectiveSiteId }) : Promise.resolve(false),
    effectiveSiteId ? userCan("site.analytics.read", session.user.id, { siteId: effectiveSiteId }) : Promise.resolve(false),
    effectiveSiteId ? userCan("site.content.create", session.user.id, { siteId: effectiveSiteId }) : Promise.resolve(false),
  ]);

  return NextResponse.json({
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
  });
}
