import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import Image from "next/image";
import { redirect } from "next/navigation";
import SiteCard from "./site-card";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { getRootSiteUrl } from "@/lib/site-url";
import { createKernelForRequest } from "@/lib/plugin-runtime";

export default async function Sites({ limit }: { limit?: number }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const siteIds = await listSiteIdsForUser(session.user.id);
  const allSites = siteIds.length > 0
    ? await db.query.sites.findMany({
        where: (sites, { inArray }) => inArray(sites.id, siteIds),
        orderBy: (sites, { asc }) => asc(sites.createdAt),
      })
    : [];
  const sites = limit ? allSites.slice(0, limit) : allSites;

  const siteUrlSetting = await getSiteUrlSetting();
  const rootUrl = siteUrlSetting.value.trim() || getRootSiteUrl();
  const siteCards = await Promise.all(
    sites.map(async (site) => {
      const kernel = await createKernelForRequest(site.id);
      const hasAnalytics = kernel.hasFilter("domain:query");
      return { site, hasAnalytics };
    }),
  );

  return siteCards.length > 0 ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {siteCards.map(({ site, hasAnalytics }) => (
        <SiteCard key={site.id} data={site} rootUrl={rootUrl} hasAnalytics={hasAnalytics} />
      ))}
    </div>
  ) : (
    <div className="mt-20 flex flex-col items-center space-x-4">
      <h1 className="font-cal text-4xl">No Sites Yet</h1>
      <Image
        alt="missing site"
        src="https://illustrations.popsy.co/gray/web-design.svg"
        width={400}
        height={400}
      />
      <p className="text-lg text-stone-500">
        You do not have any sites yet. Create one to get started.
      </p>
    </div>
  );
}
