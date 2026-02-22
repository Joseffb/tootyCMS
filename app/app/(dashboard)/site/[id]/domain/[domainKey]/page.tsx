import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import db from "@/lib/db";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteDataDomainByKey } from "@/lib/actions";
import { getSiteUrlSetting } from "@/lib/cms-config";
import CreateDomainPostButton from "@/components/create-domain-post-button";
import DomainPosts from "@/components/domain-posts";
import { pluralizeLabel } from "@/lib/data-domain-labels";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
};

export default async function SiteDomainPosts({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey } = await params;
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);

  const site = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, siteId),
  });
  if (!site || site.userId !== session.user.id) {
    notFound();
  }

  const domain = await getSiteDataDomainByKey(siteId, resolvedDomainKey);
  if (!domain || domain.key === "post") {
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
  const publicHost = configuredSiteUrl
    ? (() => {
        try {
          return new URL(configuredSiteUrl).host;
        } catch {
          return configuredSiteUrl.replace(/^https?:\/\//, "");
        }
      })()
    : derivedHost;

  return (
    <>
      <div className="flex flex-col items-center justify-between space-y-4 sm:flex-row sm:space-y-0">
        <div className="flex flex-col items-center space-y-2 sm:flex-row sm:space-x-4 sm:space-y-0">
          <h1 className="w-60 truncate font-cal text-xl font-bold sm:w-auto sm:text-3xl dark:text-white">
            All {pluralizeLabel(domain.label)} for {site.name}
          </h1>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
          >
            {publicHost} ↗
          </a>
        </div>
        <CreateDomainPostButton siteId={siteId} domainKey={resolvedDomainKey} domainLabel={domain.label} />
      </div>
      <DomainPosts siteId={siteId} domainKey={resolvedDomainKey} />
    </>
  );
}
