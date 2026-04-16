import { getSession } from "@/lib/auth";
import Link from "next/link";
import Script from "next/script";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteDataDomainByKey } from "@/lib/actions";
import { getSiteUrlSetting } from "@/lib/cms-config";
import CreateDomainPostButton from "@/components/create-domain-post-button";
import DomainPosts from "@/components/domain-posts";
import { pluralizeLabel } from "@/lib/data-domain-labels";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";
import { getDomainPostAdminListPath } from "@/lib/domain-post-admin-routes";
import { cn } from "@/lib/utils";
import { LayoutGrid, List } from "lucide-react";
import {
  DOMAIN_POST_ADMIN_VIEW_COOKIE,
  resolveDomainPostAdminView,
} from "@/lib/domain-post-admin-view";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
  }>;
  searchParams?: Promise<{
    view?: string;
  }>;
};

export default async function SiteDomainPosts({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id, domainKey } = await params;
  const resolvedSearchParams = (await searchParams) || {};
  const cookieStore = await cookies();
  const siteId = decodeURIComponent(id);
  const resolvedDomainKey = decodeURIComponent(domainKey);
  const view = resolveDomainPostAdminView({
    searchParam: resolvedSearchParams.view,
    cookieValue: cookieStore.get(DOMAIN_POST_ADMIN_VIEW_COOKIE)?.value,
  });

  const { site } = await resolveAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.domain.list",
    "site.content.read",
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!site) {
    notFound();
  }
  const effectiveSiteId = site.id;

  const domain = await getSiteDataDomainByKey(effectiveSiteId, resolvedDomainKey);
  if (!domain) {
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
  const basePath = getDomainPostAdminListPath(effectiveSiteId, resolvedDomainKey);
  const cardsHref = basePath;
  const listHref = `${basePath}?view=list`;

  return (
    <>
      <Script id="domain-post-view-state" strategy="afterInteractive">
        {`document.cookie = "${DOMAIN_POST_ADMIN_VIEW_COOKIE}=${view}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax";`}
      </Script>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <h1 className="w-60 truncate font-cal text-xl font-bold sm:w-auto sm:text-3xl dark:text-white">
            All {pluralizeLabel(domain.label)} for {site.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate rounded-md bg-stone-100 px-2 py-1 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
            >
              {publicHost} ↗
            </a>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div
            className="inline-flex self-end rounded-lg border border-stone-300 bg-white p-1 shadow-sm dark:border-stone-700 dark:bg-stone-950"
            aria-label="Domain entry view"
          >
            <Link
              href={cardsHref}
              aria-label="Cards view"
              aria-current={view === "cards" ? "page" : undefined}
              title="Cards view"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                view === "cards"
                  ? "bg-black text-white dark:bg-stone-100 dark:text-stone-950"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </Link>
            <Link
              href={listHref}
              aria-label="List view"
              aria-current={view === "list" ? "page" : undefined}
              title="List view"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                view === "list"
                  ? "bg-black text-white dark:bg-stone-100 dark:text-stone-950"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
              )}
            >
              <List className="h-4 w-4" />
            </Link>
          </div>
          <CreateDomainPostButton siteId={effectiveSiteId} domainKey={resolvedDomainKey} domainLabel={domain.label} />
        </div>
      </div>
      <DomainPosts siteId={effectiveSiteId} domainKey={resolvedDomainKey} view={view} />
    </>
  );
}
