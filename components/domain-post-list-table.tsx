import Link from "next/link";
import type { SelectSite } from "@/lib/schema";
import { getDomainPostAdminItemPath } from "@/lib/domain-post-admin-routes";
import { getSitePublicUrl } from "@/lib/site-url";

type DomainPostListSite = Pick<SelectSite, "id" | "subdomain" | "customDomain" | "isPrimary">;

type DomainPostListRow = {
  id: string;
  title: string | null;
  description: string | null;
  slug: string;
  published: boolean;
  updatedAt: Date;
  createdAt: Date;
};

function statusLabel(published: boolean) {
  return published ? "Published" : "Draft";
}

export default function DomainPostListTable({
  rows,
  site,
  siteId,
  domainKey,
}: {
  rows: DomainPostListRow[];
  site: DomainPostListSite;
  siteId: string;
  domainKey: string;
}) {
  const baseUrl = getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary: site.isPrimary || site.subdomain === "main",
  }).replace(/\/$/, "");

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
      <table className="min-w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900 dark:text-stone-400">
          <tr>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Slug</th>
            <th className="px-4 py-3 font-medium">Updated</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((post) => {
            const adminHref = getDomainPostAdminItemPath(siteId, domainKey, post.id);
            const publicHref = `${baseUrl}/${domainKey}/${post.slug}`;

            return (
              <tr key={post.id} className="border-t border-stone-200 align-top dark:border-stone-700">
                <td className="px-4 py-4">
                  <Link href={adminHref} className="font-medium text-stone-900 hover:underline dark:text-white">
                    {post.title || "Untitled"}
                  </Link>
                  <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {post.description || "No description yet"}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      post.published
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    }`}
                  >
                    {statusLabel(post.published)}
                  </span>
                </td>
                <td className="px-4 py-4 text-stone-600 dark:text-stone-400">{post.slug}</td>
                <td className="px-4 py-4 text-stone-600 dark:text-stone-400">{post.updatedAt.toLocaleString()}</td>
                <td className="px-4 py-4 text-stone-600 dark:text-stone-400">{post.createdAt.toLocaleString()}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={adminHref}
                      className="rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                      Edit
                    </Link>
                    {post.published ? (
                      <a
                        href={publicHref}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-900"
                      >
                        View
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
