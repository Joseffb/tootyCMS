import Link from "next/link";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import SiteAnalyticsCharts from "@/components/site-analytics";
import { getAllDataDomains } from "@/lib/actions";
import { getSitePublicHost, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { hasGraphAnalyticsProvider } from "@/lib/analytics-availability";
import { getApprovedCommentCountsBySite, getViewCountsByPost } from "@/lib/dashboard-popularity";
import { listSiteDomainPosts } from "@/lib/site-domain-post-store";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";

type Props = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardRow = {
  id: string;
  title: string;
  slug: string;
  dataDomainId: number;
  typeKey: string;
  typeLabel: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELDS = new Set(["title", "type", "status", "slug", "createdAt", "updatedAt"]);

function readScalar(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return String(value[0] || fallback);
  return String(value || fallback);
}

function normalizeSort(raw: string) {
  return SORT_FIELDS.has(raw) ? raw : "updatedAt";
}

function normalizeDir(raw: string) {
  return raw === "asc" ? "asc" : "desc";
}

function sortRows(rows: DashboardRow[], sort: string, dir: "asc" | "desc") {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort === "title") return factor * left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (sort === "type") return factor * left.typeLabel.localeCompare(right.typeLabel, undefined, { sensitivity: "base" });
    if (sort === "status") return factor * String(left.published).localeCompare(String(right.published));
    if (sort === "slug") return factor * left.slug.localeCompare(right.slug, undefined, { sensitivity: "base" });
    if (sort === "createdAt") return factor * (left.createdAt.getTime() - right.createdAt.getTime());
    return factor * (left.updatedAt.getTime() - right.updatedAt.getTime());
  });
}

function sortHref(siteId: string, currentSort: string, currentDir: "asc" | "desc", field: string, query: string) {
  const nextDir: "asc" | "desc" = currentSort === field && currentDir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams();
  qs.set("sort", field);
  qs.set("dir", nextDir);
  if (query) qs.set("q", query);
  return `/app/site/${encodeURIComponent(siteId)}/domain?${qs.toString()}`;
}

function statusLabel(published: boolean) {
  return published ? "Published" : "Draft";
}

export default async function SiteDomainDashboard({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const siteId = decodeURIComponent((await params).id);
  const queryParams = searchParams ? await searchParams : {};
  const query = readScalar(queryParams.q).trim().toLowerCase();
  const sort = normalizeSort(readScalar(queryParams.sort));
  const dir = normalizeDir(readScalar(queryParams.dir)) as "asc" | "desc";
  const showPrivateTableRows = readScalar(queryParams.showPrivate) === "1";

  const { site } = await resolveAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.domain.list",
    "site.content.read",
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!site) notFound();
  const effectiveSiteId = site.id;

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
  const domainHost = process.env.NODE_ENV === "development"
    ? derivedHost
    : (configuredSiteUrl
      ? (() => {
          try {
            return new URL(configuredSiteUrl).host;
          } catch {
            return configuredSiteUrl.replace(/^https?:\/\//, "");
          }
        })()
      : derivedHost);

  const analyticsGraphCapable = await hasGraphAnalyticsProvider(effectiveSiteId);
  const domainVisibility = await getAllDataDomains(effectiveSiteId, {
    ensurePhysicalTables: false,
    includeUsageCount: false,
  });
  const publicDomainIds = new Set(
    domainVisibility
      .filter((domain: any) => domain.assigned && domain.isActive !== false)
      .filter((domain: any) => domain?.settings?.showInMenu !== false)
      .map((domain: any) => Number(domain.id))
      .filter((id: number) => Number.isFinite(id)),
  );

  const rowsRaw = await listSiteDomainPosts({
    siteId: effectiveSiteId,
    includeInactiveDomains: true,
  });

  const normalizedRows: DashboardRow[] = rowsRaw.map((row) => ({
    id: String(row.id),
    title: String(row.title || "Untitled"),
    slug: String(row.slug || ""),
    dataDomainId: Number(row.dataDomainId || 0),
    typeKey: String(row.dataDomainKey || ""),
    typeLabel: String(row.dataDomainLabel || row.dataDomainKey || "Unknown"),
    published: Boolean(row.published),
    createdAt: row.createdAt || new Date(0),
    updatedAt: row.updatedAt || new Date(0),
  }));
  const visibleRows = normalizedRows.filter((row) => publicDomainIds.has(row.dataDomainId));
  const tableBaseRows = showPrivateTableRows
    ? normalizedRows
    : visibleRows;

  const filteredRows = query
    ? tableBaseRows.filter((row) =>
        row.title.toLowerCase().includes(query) ||
        row.slug.toLowerCase().includes(query) ||
        row.typeLabel.toLowerCase().includes(query) ||
        row.typeKey.toLowerCase().includes(query),
      )
    : tableBaseRows;

  const sortedRows = sortRows(filteredRows, sort, dir);

  const totalArticles = visibleRows.length;
  const publishedArticles = visibleRows.filter((row) => row.published).length;
  const draftArticles = totalArticles - publishedArticles;
  const domainTypes = publicDomainIds.size;
  const publishedVisibleRows = visibleRows.filter((row) => row.published);
  const newestRows = [...publishedVisibleRows]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 12);
  const commentCounts = await getApprovedCommentCountsBySite(
    new Map([[effectiveSiteId, publishedVisibleRows.map((row) => row.id)]]),
  );
  const viewCounts = await getViewCountsByPost(
    publishedVisibleRows.map((row) => ({
      id: row.id,
      siteId: effectiveSiteId,
      dataDomainKey: row.typeKey,
    })),
  );
  const popularRows = [...publishedVisibleRows]
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-cal text-3xl font-bold dark:text-white">{site.name} Dashboard</h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Site-level overview, analytics, and cross-domain article listing.
          </p>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
        >
          {domainHost} ↗
        </a>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Total Articles</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{totalArticles}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Published</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{publishedArticles}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Drafts</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{draftArticles}</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
            <div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">Domain Types</div>
            <div className="mt-2 text-3xl font-semibold text-stone-900 dark:text-white">{domainTypes}</div>
          </div>
        </div>

        {analyticsGraphCapable ? (
          <div className="rounded-xl border border-stone-200 bg-white p-4 lg:col-span-2 dark:border-stone-700 dark:bg-black">
            <div className="mb-3 text-base font-semibold text-stone-900 dark:text-white">Analytics</div>
            <SiteAnalyticsCharts domain={domainHost} siteId={effectiveSiteId} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600 lg:col-span-2 dark:border-stone-700 dark:bg-black dark:text-stone-400">
            Analytics is hidden until a graph-capable analytics provider is enabled for this site.
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-white">All Articles</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Includes all domain types; sortable by each column.
            </p>
          </div>
          <form method="get" className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search title, slug, type"
              className="w-64 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
            <input type="hidden" name="showPrivate" value={showPrivateTableRows ? "1" : "0"} />
            <button type="submit" className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
              Search
            </button>
          </form>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Table Scope</span>
          <Link
            href={`/app/site/${encodeURIComponent(effectiveSiteId)}/domain?${new URLSearchParams({
              sort,
              dir,
              ...(query ? { q: query } : {}),
              showPrivate: "0",
            }).toString()}`}
            className={`rounded-md border px-2 py-1 text-xs font-semibold ${
              !showPrivateTableRows
                ? "border-black bg-black text-white"
                : "border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300"
            }`}
          >
            Public only
          </Link>
          <Link
            href={`/app/site/${encodeURIComponent(effectiveSiteId)}/domain?${new URLSearchParams({
              sort,
              dir,
              ...(query ? { q: query } : {}),
              showPrivate: "1",
            }).toString()}`}
            className={`rounded-md border px-2 py-1 text-xs font-semibold ${
              showPrivateTableRows
                ? "border-black bg-black text-white"
                : "border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300"
            }`}
          >
            Include private
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
              <tr>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "title", query)}>Title</Link></th>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "type", query)}>Type</Link></th>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "status", query)}>Status</Link></th>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "slug", query)}>Slug</Link></th>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "updatedAt", query)}>Updated</Link></th>
                <th className="px-2 py-2"><Link href={sortHref(effectiveSiteId, sort, dir, "createdAt", query)}>Created</Link></th>
                {analyticsGraphCapable ? <th className="px-2 py-2">Analytics Trend</th> : null}
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800">
                  <td className="px-2 py-2 font-medium text-stone-900 dark:text-white">{row.title}</td>
                  <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.typeLabel}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${row.published ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                      {statusLabel(row.published)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{row.slug}</td>
                  <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{row.updatedAt.toLocaleString()}</td>
                  <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{row.createdAt.toLocaleString()}</td>
                  {analyticsGraphCapable ? <td className="px-2 py-2 text-stone-500 dark:text-stone-400">Hidden</td> : null}
                  <td className="px-2 py-2">
                    <Link
                      href={`/app/site/${encodeURIComponent(effectiveSiteId)}/domain/${encodeURIComponent(row.typeKey)}/post/${encodeURIComponent(row.id)}`}
                      className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:text-stone-200"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={analyticsGraphCapable ? 8 : 7} className="px-2 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
                    No articles found for this query.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Newest Articles</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
                <tr>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {newestRows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800">
                    <td className="px-2 py-2">
                      <Link
                        href={`/app/site/${encodeURIComponent(effectiveSiteId)}/domain/${encodeURIComponent(row.typeKey)}/post/${encodeURIComponent(row.id)}`}
                        className="font-medium text-stone-900 hover:underline dark:text-white"
                      >
                        {row.title}
                      </Link>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{row.slug}</div>
                    </td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.typeLabel}</td>
                    <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{row.updatedAt.toLocaleString()}</td>
                  </tr>
                ))}
                {newestRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
                      No published articles found yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-white">Most Popular Articles</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Ranked by guarded view count, then approved comments, then recency.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
                <tr>
                  <th className="px-2 py-2">Title</th>
                  <th className="px-2 py-2">Type</th>
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
                        href={`/app/site/${encodeURIComponent(effectiveSiteId)}/domain/${encodeURIComponent(row.typeKey)}/post/${encodeURIComponent(row.id)}`}
                        className="font-medium text-stone-900 hover:underline dark:text-white"
                      >
                        {row.title}
                      </Link>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{row.slug}</div>
                    </td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{row.typeLabel}</td>
                    <td className="px-2 py-2 text-stone-600 dark:text-stone-400">{statusLabel(row.published)}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{viewCounts.get(row.id) || 0}</td>
                    <td className="px-2 py-2 text-stone-700 dark:text-stone-300">{commentCounts.get(row.id) || 0}</td>
                  </tr>
                ))}
                {popularRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
                      No published articles found yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
