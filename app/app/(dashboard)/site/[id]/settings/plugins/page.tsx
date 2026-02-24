import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import {
  listPluginsWithSiteState,
  saveSitePluginConfig,
  setPluginEnabled,
  setSitePluginEnabled,
} from "@/lib/plugin-runtime";
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
  const ownedSites = await db.query.sites.findMany({
    where: (sites, { eq }) => eq(sites.userId, session.user.id),
    columns: { id: true },
  });
  const singleSiteMode = ownedSites.length === 1;

  const plugins = (await listPluginsWithSiteState(site.id)).filter(
    (plugin) => (plugin.scope || "site") === "site",
  );

  async function toggleForSite(formData: FormData) {
    "use server";
    const siteId = String(formData.get("siteId") || "");
    const pluginId = String(formData.get("pluginId") || "");
    const enabled = formData.get("enabled") === "on";
    if (!siteId || !pluginId) return;
    if (singleSiteMode) {
      await setPluginEnabled(pluginId, enabled);
    }
    await setSitePluginEnabled(siteId, pluginId, enabled);
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
    if (singleSiteMode) {
      revalidatePath("/settings/plugins");
      revalidatePath("/app/settings/plugins");
    }
  }

  async function saveSiteConfig(formData: FormData) {
    "use server";
    const siteId = String(formData.get("siteId") || "");
    const pluginId = String(formData.get("pluginId") || "");
    if (!siteId || !pluginId) return;
    const plugin = (await listPluginsWithSiteState(siteId)).find((entry) => entry.id === pluginId);
    if (!plugin || plugin.mustUse) return;

    const nextConfig: Record<string, unknown> = {};
    for (const field of plugin.settingsFields || []) {
      nextConfig[field.key] = field.type === "checkbox" ? formData.get(field.key) === "on" : String(formData.get(field.key) || "");
    }

    await saveSitePluginConfig(siteId, pluginId, nextConfig);
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Site Plugins</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Use this page to activate plugins to add functionality to your site.
        </p>
        {!singleSiteMode && (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Note: Global plugin settings controls availability and defaults. This page controls site activation and site-specific overrides.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Plugin</th>
              <th className="px-4 py-3">Global</th>
              <th className="px-4 py-3">Site Activation</th>
              <th className="px-4 py-3">Site Settings</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((plugin) => (
              <tr key={plugin.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-4 py-3 align-top">
                  <div className="flex items-baseline gap-2">
                    <div className="font-medium text-stone-900 dark:text-white">{plugin.name}</div>
                    <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                      {(plugin.scope || "site") === "core" ? "Core" : "Site"}
                    </span>
                    {plugin.developer ? (
                      <div className="text-xs text-stone-500 italic">
                        by{" "}
                        {plugin.website ? (
                          <a
                            href={plugin.website}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-stone-700 dark:hover:text-stone-300"
                          >
                            {plugin.developer}
                          </a>
                        ) : (
                          plugin.developer
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-xs text-stone-500">{plugin.id}</div>
                  <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">{plugin.description}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        plugin.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"
                      }`}
                    >
                      {plugin.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {plugin.mustUse && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">Must Use</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  {plugin.enabled || singleSiteMode ? (
                    <form action={toggleForSite} className="flex items-center gap-2">
                      <input type="hidden" name="siteId" value={site.id} />
                      <input type="hidden" name="pluginId" value={plugin.id} />
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={plugin.siteEnabled}
                          disabled={plugin.mustUse && !singleSiteMode}
                          className="h-4 w-4"
                        />
                        <span className="text-xs text-stone-600 dark:text-stone-300">Active</span>
                      </label>
                      <button
                        disabled={plugin.mustUse && !singleSiteMode}
                        className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-full bg-stone-200 px-2 py-1 text-xs font-medium text-stone-700">
                      Inactive (global disabled)
                    </span>
                  )}
                  {plugin.mustUse && !singleSiteMode && (
                    <p className="mt-2 text-xs text-stone-500">Must Use is enabled globally. This site cannot disable it.</p>
                  )}
                  {!plugin.enabled && !singleSiteMode && (
                    <p className="mt-2 text-xs text-stone-500">Enable globally first to activate on this site.</p>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  {(plugin.settingsFields || []).length > 0 ? (
                    plugin.mustUse && !singleSiteMode ? (
                      <p className="text-xs text-stone-500">Must Use is enabled globally. Site overrides are disabled.</p>
                    ) : !plugin.enabled && !singleSiteMode ? (
                      <p className="text-xs text-stone-500">Enable globally to configure site-level overrides.</p>
                    ) : (
                      <details className="rounded-md border border-stone-200 p-2 dark:border-stone-700">
                        <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Configure site values</summary>
                        <form action={saveSiteConfig} className="mt-2 grid gap-2">
                          <input type="hidden" name="siteId" value={site.id} />
                          <input type="hidden" name="pluginId" value={plugin.id} />
                          {(plugin.settingsFields || []).map((field) => (
                            <label key={field.key} className="flex flex-col gap-1 text-xs">
                              <span className="font-medium text-stone-700 dark:text-stone-300">{field.label}</span>
                              {field.type === "checkbox" ? (
                                <input
                                  type="checkbox"
                                  name={field.key}
                                  defaultChecked={Boolean(plugin.siteConfig[field.key] ?? plugin.config[field.key])}
                                  className="h-4 w-4"
                                />
                              ) : field.type === "select" ? (
                                <select
                                  name={field.key}
                                  defaultValue={String(plugin.siteConfig[field.key] ?? plugin.config[field.key] ?? field.defaultValue ?? "")}
                                  className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                                >
                                  {(field.options || []).map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : field.type === "textarea" ? (
                                <textarea
                                  name={field.key}
                                  defaultValue={String(plugin.siteConfig[field.key] ?? plugin.config[field.key] ?? "")}
                                  className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                                />
                              ) : (
                                <input
                                  type={field.type || "text"}
                                  name={field.key}
                                  defaultValue={String(plugin.siteConfig[field.key] ?? plugin.config[field.key] ?? "")}
                                  className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                                />
                              )}
                            </label>
                          ))}
                          <button className="w-fit rounded-md border border-black bg-black px-3 py-1 text-xs text-white">
                            Save Site Settings
                          </button>
                        </form>
                      </details>
                    )
                  ) : (
                    <p className="text-xs text-stone-500">No settings fields.</p>
                  )}
                </td>
              </tr>
            ))}
            {plugins.length === 0 && (
              <tr className="border-t border-stone-200 dark:border-stone-700">
                <td colSpan={4} className="px-4 py-6 text-sm text-stone-500 dark:text-stone-400">
                  No plugins discovered. Check `PLUGINS_PATH` and ensure each plugin directory has a valid `plugin.json`.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
