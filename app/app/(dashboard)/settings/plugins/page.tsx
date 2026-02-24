import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getPluginById,
  listPluginsWithState,
  savePluginConfig,
  setPluginEnabled,
  setPluginMustUse,
  setSitePluginEnabled,
} from "@/lib/plugin-runtime";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";

export default async function PluginSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const ownedSites = await db.query.sites.findMany({
    where: (sites, { eq }) => eq(sites.userId, session.user.id),
    columns: { id: true, isPrimary: true, subdomain: true },
  });
  const singleSiteMode = ownedSites.length === 1;
  const mainSiteId = singleSiteMode
    ? (ownedSites.find((site) => site.isPrimary || site.subdomain === "main")?.id || ownedSites[0]?.id || null)
    : null;

  const plugins = await listPluginsWithState();

  async function togglePlugin(formData: FormData) {
    "use server";
    const pluginId = String(formData.get("pluginId") || "");
    const enabled = formData.get("enabled") === "on";
    const mustUse = formData.get("mustUse") === "on";
    await setPluginEnabled(pluginId, enabled);
    await setPluginMustUse(pluginId, mustUse);
    if (singleSiteMode && mainSiteId) {
      const plugin = await getPluginById(pluginId);
      if (plugin && (plugin.scope || "site") === "site") {
        await setSitePluginEnabled(mainSiteId, pluginId, enabled || mustUse);
        revalidatePath(`/site/${mainSiteId}/settings/plugins`);
        revalidatePath(`/app/site/${mainSiteId}/settings/plugins`);
      }
    }
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
  }

  async function saveConfig(formData: FormData) {
    "use server";
    const pluginId = String(formData.get("pluginId") || "");
    const plugin = (await listPluginsWithState()).find((p) => p.id === pluginId);
    if (!plugin) return;

    const config: Record<string, unknown> = {};
    for (const field of plugin.settingsFields || []) {
      config[field.key] = field.type === "checkbox" ? formData.get(field.key) === "on" : String(formData.get(field.key) || "");
    }

    await savePluginConfig(pluginId, config);
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Plugins are discovered from configured paths (comma-separated in `PLUGINS_PATH`) and use global settings here as gate + defaults for site plugins.
      </p>
      {singleSiteMode ? (
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Single-site mode: global plugin enablement is mirrored to this site. Site plugin settings use global defaults unless explicitly overridden.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Plugin</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
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
                  <span className="text-xs text-stone-500">Inherited</span>
                </td>
                <td className="px-4 py-3 align-top text-stone-700 dark:text-stone-300">{plugin.version || "n/a"}</td>
                <td className="px-4 py-3 align-top">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${plugin.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"}`}>
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={togglePlugin} className="flex items-center gap-2">
                      <input type="hidden" name="pluginId" value={plugin.id} />
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="enabled" defaultChecked={plugin.enabled} className="h-4 w-4" />
                        <span className="text-xs text-stone-600 dark:text-stone-300">Enabled</span>
                      </label>
                      {(plugin.scope || "site") === "site" && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="mustUse" defaultChecked={plugin.mustUse} className="h-4 w-4" />
                          <span className="text-xs text-stone-600 dark:text-stone-300">Must Use</span>
                        </label>
                      )}
                      <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Save</button>
                    </form>
                    <Link href={`/plugins/${plugin.id}`} className="rounded-md border border-stone-300 px-3 py-1 text-xs dark:border-stone-600 dark:text-white">
                      Open Setup
                    </Link>
                  </div>

                  {(plugin.settingsFields || []).length > 0 && (
                    <details className="mt-3 rounded-md border border-stone-200 p-2 dark:border-stone-700">
                      <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Quick settings</summary>
                      <form action={saveConfig} className="mt-2 grid gap-2">
                        <input type="hidden" name="pluginId" value={plugin.id} />
                        {(plugin.settingsFields || []).map((field) => (
                          <label key={field.key} className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-stone-700 dark:text-stone-300">{field.label}</span>
                            {field.type === "checkbox" ? (
                              <input type="checkbox" name={field.key} defaultChecked={Boolean(plugin.config[field.key])} className="h-4 w-4" />
                            ) : field.type === "select" ? (
                              <select
                                name={field.key}
                                defaultValue={String(plugin.config[field.key] || field.defaultValue || "")}
                                className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white"
                              >
                                {(field.options || []).map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : field.type === "textarea" ? (
                              <textarea name={field.key} defaultValue={String(plugin.config[field.key] || "")} className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white" />
                            ) : (
                              <input type={field.type || "text"} name={field.key} defaultValue={String(plugin.config[field.key] || "")} className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white" />
                            )}
                          </label>
                        ))}
                        <button className="w-fit rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Save Plugin Settings</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
