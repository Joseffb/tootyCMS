import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import db from "@/lib/db";
import { sites, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";

function getSiteUrl(
  site: { subdomain: string | null; customDomain: string | null; isPrimary?: boolean },
  configuredRootUrl: string,
) {
  const isPrimary = site.isPrimary || site.subdomain === "main";
  if (isPrimary && configuredRootUrl) {
    return configuredRootUrl;
  }
  return getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary,
  });
}

export default async function SitesSettingsIndexPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });

  const sitesList = await db.query.sites.findMany({
    where: me?.role === "administrator" ? undefined : eq(sites.userId, session.user.id),
    columns: {
      id: true,
      name: true,
      subdomain: true,
      customDomain: true,
      updatedAt: true,
      isPrimary: true,
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  const configuredRootUrl = (await getSiteUrlSetting()).value.trim();

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Open any site-specific settings page from this table.
      </p>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Site</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sitesList.map((site) => (
              <tr key={site.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-4 py-3">
                  <div className="font-medium text-stone-900 dark:text-white">{site.name || site.subdomain || site.id}</div>
                  <div className="text-xs text-stone-500">{site.id}</div>
                </td>
                <td className="px-4 py-3">
                  {getSiteUrl(site, configuredRootUrl) ? (
                    <a href={getSiteUrl(site, configuredRootUrl)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                      {getSiteUrl(site, configuredRootUrl)}
                    </a>
                  ) : (
                    <span className="text-xs text-stone-500">No URL</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
                  {site.updatedAt ? new Date(site.updatedAt).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/site/${site.id}/settings`}
                    className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white"
                  >
                    Open Site Settings
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
