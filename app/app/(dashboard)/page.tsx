import Link from "next/link";
import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getAllDataDomains } from "@/lib/actions";
import { hasGraphAnalyticsProvider } from "@/lib/analytics-availability";
import OverviewStats from "@/components/overview-stats";
import { getApprovedCommentCountsBySite, getViewCountsByPost } from "@/lib/dashboard-popularity";
import { listNetworkDomainPosts } from "@/lib/site-domain-post-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type DashboardPostRow = {
  id: string;
  title: string;
  slug: string;
  siteId: string;
  siteName: string;
  dataDomainId: number;
  typeKey: string;
  typeLabel: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
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

function toHost(site: { subdomain: string | null; customDomain: string | null; isPrimary: boolean }, rootUrl: string) {
  if (site.isPrimary && rootUrl) {
    try {
      return new URL(rootUrl).host;
    } catch {
      return rootUrl.replace(/^https?:\/\//, "");
    }
  }
  return getSitePublicHost({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary: site.isPrimary,
  });
}

function toPublicUrl(site: { subdomain: string | null; customDomain: string | null; isPrimary: boolean }, rootUrl: string) {
  if (site.isPrimary && rootUrl) return rootUrl;
  return getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary: site.isPrimary,
  });
}

function statusLabel(published: boolean) {
  return published ? "Published" : "Draft";
}

export default async function Overview() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  const memberSites = accessibleSiteIds.length
    ? await db.query.sites.findMany({
        where: inArray(sites.id, accessibleSiteIds),
        columns: {
          id: true,
          name: true,
          subdomain: true,
          customDomain: true,
          isPrimary: true,
          updatedAt: true,
        },
        orderBy: (table, { asc }) => [asc(table.name)],
      })
    : [];

  if (memberSites.length === 1) {
    const primary = memberSites.find((site) => site.isPrimary || site.subdomain === "main") || memberSites[0];
    redirect(`/app/site/${primary.id}`);
  }

  const rootUrl = (await getSiteUrlSetting()).value.trim();
  const publicDomainIdsBySite = new Map<string, Set<number>>();
  await Promise.all(
    memberSites.map(async (site) => {
      const domains = await getAllDataDomains(site.id);
      const visibleIds = domains
        .filter((domain: any) => {
          if (!domain.assigned || domain.isActive === false) return false;
          const parsed = parseDomainSettings(domain?.settings);
          return parsed?.showInMenu !== false;
        })
        .map((domain: any) => Number(domain.id))
        .filter((id: number) => Number.isFinite(id));
      publicDomainIdsBySite.set(site.id, new Set(visibleIds));
    }),
  );

  const rowsRaw = accessibleSiteIds.length
    ? await listNetworkDomainPosts({
        siteIds: accessibleSiteIds,
      })
    : [];
  const siteNameMap = new Map(
    memberSites.map((site) => [
      site.id,
      String(site.name || site.subdomain || site.id || "Unknown site"),
    ]),
  );

  const normalizedRows: DashboardPostRow[] = rowsRaw.map((row) => ({
    id: String(row.id),
    title: String(row.title || "Untitled"),
    slug: String(row.slug || ""),
    siteId: String(row.siteId || ""),
    siteName: String(siteNameMap.get(String(row.siteId || "")) || row.siteId || "Unknown site"),
    dataDomainId: Number(row.dataDomainId || 0),
    typeKey: String(row.dataDomainKey || ""),
    typeLabel: String(row.dataDomainLabel || row.dataDomainKey || "Unknown"),
    published: Boolean(row.published),
    createdAt: row.createdAt || new Date(0),
    updatedAt: row.updatedAt || new Date(0),
  }));

  const visibleRows = normalizedRows.filter((row) => publicDomainIdsBySite.get(row.siteId)?.has(row.dataDomainId));
  const totalArticles = visibleRows.length;
  const publishedArticles = visibleRows.filter((row) => row.published).length;
  const draftArticles = totalArticles - publishedArticles;
  const domainTypes = new Set(visibleRows.map((row) => `${row.siteId}:${row.dataDomainId}`)).size;

  const analyticsBySite = await Promise.all(memberSites.map((site) => hasGraphAnalyticsProvider(site.id)));
  const hasNetworkAnalytics = analyticsBySite.some(Boolean);

  const publishedRows = visibleRows.filter((row) => row.published);
  const newestRows = [...publishedRows]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 12);
  const postIdsBySite = new Map<string, string[]>();
  for (const row of publishedRows) {
    const current = postIdsBySite.get(row.siteId) || [];
    current.push(row.id);
    postIdsBySite.set(row.siteId, current);
  }
  const commentCounts = await getApprovedCommentCountsBySite(postIdsBySite);
  const viewCounts = await getViewCountsByPost(
    publishedRows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      dataDomainKey: row.typeKey,
    })),
  );
  const popularRows = [...publishedRows]
    .sort((left, right) => {
      const leftViews = viewCounts.get(left.id) || 0;
      const rightViews = viewCounts.get(right.id) || 0;
      if (rightViews !== leftViews) return rightViews - leftViews;
      const leftScore = commentCounts.get(left.id) || 0;
      const rightScore = commentCounts.get(right.id) || 0;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, 12);

  const siteStats = memberSites.map((site) => {
    const rows = visibleRows.filter((row) => row.siteId === site.id);
    const published = rows.filter((row) => row.published).length;
    return {
      id: site.id,
      name: site.name || site.subdomain || site.id,
      host: toHost(
        {
          subdomain: site.subdomain,
          customDomain: site.customDomain,
          isPrimary: Boolean(site.isPrimary || site.subdomain === "main"),
        },
        rootUrl,
      ),
      publicUrl: toPublicUrl(
        {
          subdomain: site.subdomain,
          customDomain: site.customDomain,
          isPrimary: Boolean(site.isPrimary || site.subdomain === "main"),
        },
        rootUrl,
      ),
      total: rows.length,
      published,
      drafts: rows.length - published,
      updatedAt: site.updatedAt || new Date(0),
    };
  });

  if (memberSites.length === 0) {
    return (
      <div className="flex w-full max-w-none flex-col space-y-6 p-8">
        <h1 className="font-cal text-3xl font-bold light:text-black">Network Dashboard</h1>
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600 dark:border-stone-700 dark:bg-black dark:text-stone-300">
          No accessible sites were found for your account.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-none flex-col space-y-6 p-8">
      <div>
        <h1 className="font-cal text-3xl font-bold dark:text-white">Network Dashboard</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Network-wide snapshot across accessible public data domains.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Domain Types</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{domainTypes}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Published</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{publishedArticles}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Total Articles</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{totalArticles}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Drafts</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{draftArticles}</div>
          </div>
        </div>

        {hasNetworkAnalytics ? (
          <div className="rounded-xl border border-stone-200 bg-white p-4 lg:col-span-2 dark:border-stone-700 dark:bg-black">
            <div className="mb-3 text-base font-semibold text-stone-900 dark:text-white">Analytics</div>
            <OverviewStats />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600 lg:col-span-2 dark:border-stone-700 dark:bg-black dark:text-stone-400">
            Analytics is hidden until at least one site has a graph-capable analytics provider enabled.
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Newest Articles (Network)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
                <tr>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Site</th>
                  <th className="px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {newestRows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800">
                    <td className="px-2 py-2">
                      <Link
                        href={`/app/site/${encodeURIComponent(row.siteId)}/domain/${encodeURIComponent(row.typeKey)}/post/${encodeURIComponent(row.id)}`}
                        className="font-medium text-stone-900 hover:underline dark:text-white"
                      >
                        {row.title}
                      </Link>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{row.slug}</div>
                    </td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.typeLabel}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.siteName}</td>
                    <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{row.updatedAt.toLocaleString()}</td>
                  </tr>
                ))}
                {newestRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
                      No published articles found yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Most Popular Articles (Network)</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Ranked by guarded view count, then approved comments, then recency.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
                <tr>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Site</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Views</th>
                  <th className="px-2 py-2">Comments</th>
                </tr>
              </thead>
              <tbody>
                {popularRows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800">
                    <td className="px-2 py-2">
                      <Link
                        href={`/app/site/${encodeURIComponent(row.siteId)}/domain/${encodeURIComponent(row.typeKey)}/post/${encodeURIComponent(row.id)}`}
                        className="font-medium text-stone-900 hover:underline dark:text-white"
                      >
                        {row.title}
                      </Link>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{row.slug}</div>
                    </td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.typeLabel}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.siteName}</td>
                    <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{statusLabel(row.published)}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{viewCounts.get(row.id) || 0}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{commentCounts.get(row.id) || 0}</td>
                  </tr>
                ))}
                {popularRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
                      No published articles found yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Sites</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">Accessible sites with article counts across public domains.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
              <tr>
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Domain</th>
                <th className="px-2 py-2">Articles</th>
                <th className="px-2 py-2">Published</th>
                <th className="px-2 py-2">Drafts</th>
                <th className="px-2 py-2">Updated</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {siteStats.map((site) => (
                <tr key={site.id} className="border-b border-stone-100 dark:border-stone-800">
                  <td className="px-2 py-2 font-medium text-stone-900 dark:text-white">{site.name}</td>
                  <td className="px-2 py-2">
                    <a href={site.publicUrl} target="_blank" rel="noreferrer" className="text-stone-700 hover:underline dark:text-stone-300">
                      {site.host}
                    </a>
                  </td>
                  <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{site.total}</td>
                  <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{site.published}</td>
                  <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{site.drafts}</td>
                  <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{site.updatedAt.toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/app/site/${encodeURIComponent(site.id)}`}
                      className="inline-flex items-center rounded-md bg-green-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
