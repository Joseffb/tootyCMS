// app/(dashboard)/site/[id]/analytics/page.tsx

import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import db from "@/lib/db";
import SiteAnalyticsCharts from "@/components/site-analytics";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";

type PageProps = {
  // Next.js is expecting params to be a Promise here
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  // await the promise to get the actual params object
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const site = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, decodeURIComponent(id)),
  });
  if (!site || site.userId !== session.user.id) {
    notFound();
  }

  const isPrimary = site.isPrimary || site.subdomain === "main";
  const derivedUrl = getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary,
  });
  const derivedHost = getSitePublicHost({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary,
  });
  const configuredSiteUrl = isPrimary ? (await getSiteUrlSetting()).value.trim() : "";
  const publicUrl = configuredSiteUrl || derivedUrl;
  const configuredHost = configuredSiteUrl
    ? (() => {
        try {
          return new URL(configuredSiteUrl).host;
        } catch {
          return configuredSiteUrl.replace(/^https?:\/\//, "");
        }
      })()
    : "";
  const domain = process.env.NODE_ENV === "development" ? derivedHost : configuredHost || derivedHost;

  return (
    <>
      <div className="flex items-center justify-center sm:justify-start">
        <div className="flex flex-col items-center space-x-0 space-y-2 sm:flex-row sm:space-x-4 sm:space-y-0">
          <h1 className="font-cal text-xl font-bold sm:text-3xl dark:text-white">
            Analytics for {site.name}
          </h1>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            {domain} ↗
          </a>
        </div>
      </div>

      <SiteAnalyticsCharts domain={domain} siteId={site.id} />
    </>
  );
}
