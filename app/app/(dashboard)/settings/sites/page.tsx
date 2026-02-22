import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import db from "@/lib/db";
import { isAdministrator } from "@/lib/rbac";
import { sites, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSitePublicUrl } from "@/lib/site-url";
import {
  getSiteUrlSetting,
  getTextSetting,
  setBooleanSetting,
  setTextSetting,
  THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY,
  THEME_QUERY_NETWORK_ENABLED_KEY,
} from "@/lib/cms-config";

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
    where: isAdministrator(me?.role) ? undefined : eq(sites.userId, session.user.id),
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
  const [queryNetworkEnabled, queryNetworkAllowedSiteIds] = await Promise.all([
    getTextSetting(THEME_QUERY_NETWORK_ENABLED_KEY, "false"),
    getTextSetting(THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY, ""),
  ]);

  async function updateQueryNetworkSettings(formData: FormData) {
    "use server";
    const session = await getSession();
    if (!session?.user?.id) redirect("/login");
    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { role: true },
    });
    if (!isAdministrator(me?.role)) return;
    const enabled = formData.get("enabled") === "on";
    const allowedSiteIds = String(formData.get("allowedSiteIds") || "");
    await setBooleanSetting(THEME_QUERY_NETWORK_ENABLED_KEY, enabled);
    await setTextSetting(THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY, allowedSiteIds);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Theme Query Network (Governance)</h3>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
          Enables `scope=network` theme queries. Main site can aggregate all owner sites. Non-main sites must be listed here.
        </p>
        <form action={updateQueryNetworkSettings} className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={queryNetworkEnabled === "true"}
              className="h-4 w-4 rounded border-stone-300"
            />
            Enable Query Network
          </label>
          <label className="block text-sm text-stone-700 dark:text-stone-200">
            <span className="mb-1 block text-xs">Permissioned Site IDs (comma-separated)</span>
            <input
              type="text"
              name="allowedSiteIds"
              defaultValue={queryNetworkAllowedSiteIds}
              placeholder="site_id_1,site_id_2"
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-900"
            />
          </label>
          <button type="submit" className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">
            Save Query Network Settings
          </button>
        </form>
      </section>

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
