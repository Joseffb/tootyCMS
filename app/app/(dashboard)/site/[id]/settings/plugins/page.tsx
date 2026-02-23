import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { listPluginsWithSiteState, setSitePluginEnabled } from "@/lib/plugin-runtime";
import { revalidatePath } from "next/cache";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SitePluginSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const id = decodeURIComponent((await params).id);
  const site = await db.query.sites.findFirst({ where: (sites, { eq }) => eq(sites.id, id) });
  if (!site || site.userId !== session.user.id) notFound();

  const plugins = (await listPluginsWithSiteState(site.id)).filter((plugin) => (plugin.scope || "site") === "site");

  async function toggleForSite(formData: FormData) {
    "use server";
    const siteId = String(formData.get("siteId") || "");
    const pluginId = String(formData.get("pluginId") || "");
    const enabled = formData.get("enabled") === "on";
    if (!siteId || !pluginId) return;
    await setSitePluginEnabled(siteId, pluginId, enabled);
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Site Plugins</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Global plugin settings control availability. This page controls whether each site-scoped plugin is active for this site.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Plugin</th>
              <th className="px-4 py-3">Global</th>
              <th className="px-4 py-3">This Site</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((plugin) => (
              <tr key={plugin.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-stone-900 dark:text-white">{plugin.name}</div>
                  <div className="text-xs text-stone-500">{plugin.id}</div>
                  <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">{plugin.description}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${plugin.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"}`}
                  >
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <form action={toggleForSite} className="flex items-center gap-2">
                    <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="pluginId" value={plugin.id} />
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={plugin.enabled && plugin.siteEnabled}
                        disabled={!plugin.enabled}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-stone-600 dark:text-stone-300">Active</span>
                    </label>
                    <button
                      disabled={!plugin.enabled}
                      className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
