import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ siteCount: 0, mainSiteId: null, sites: [] });
  }

  const ownedSites = await db.query.sites.findMany({
    where: (sites, { eq }) => eq(sites.userId, session.user.id),
    columns: { id: true, name: true, isPrimary: true, subdomain: true },
  });

  const primary =
    ownedSites.find((site) => site.isPrimary || site.subdomain === "main") ||
    ownedSites[0] ||
    null;

  return NextResponse.json({
    siteCount: ownedSites.length,
    mainSiteId: primary?.id || null,
    sites: ownedSites.map((site) => ({
      id: site.id,
      name: site.name || site.subdomain || site.id,
    })),
  });
}
