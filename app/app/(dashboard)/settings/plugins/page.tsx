import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import CatalogTabs from "@/components/catalog-tabs";
import {
  getPluginById,
  getAvailablePlugins,
  listPluginsWithState,
  savePluginConfig,
  setPluginEnabled,
  setPluginNetworkRequired,
  setSitePluginEnabled,
} from "@/lib/plugin-runtime";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import {
  installFromRepo,
  listLocalInstalledIds,
  listRepoCatalog,
  toRepoCatalogFriendlyError,
} from "@/lib/repo-catalog";
import { userCan } from "@/lib/authorization";
import { listSiteIdsForUser } from "@/lib/site-user-tables";
import { inArray } from "drizzle-orm";

type Props = {
  searchParams?: Promise<{ tab?: string; q?: string; error?: string; view?: string }>;
};

export default async function PluginSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManageNetworkPlugins = await userCan("network.plugins.manage", session.user.id);
  if (!canManageNetworkPlugins) redirect("/app");
  const params = (await searchParams) || {};
  const activeTab = params.tab === "discover" ? "discover" : "installed";
  const query = String(params.q || "");
  const errorCode = String(params.error || "");
  const view = params.view === "installed" || params.view === "uninstalled" ? params.view : "all";

  const canManageNetworkSites = await userCan("network.site.manage", session.user.id);
  const accessibleSiteIds = canManageNetworkSites ? [] : await listSiteIdsForUser(session.user.id);
  const ownedSites = await db.query.sites.findMany({
    where: canManageNetworkSites
      ? undefined
      : (sites) =>
          accessibleSiteIds.length
            ? inArray(sites.id, accessibleSiteIds)
            : inArray(sites.id, ["__none__"]),
    columns: { id: true, isPrimary: true, subdomain: true },
  });
  const singleSiteMode = ownedSites.length === 1;
  const mainSiteId = singleSiteMode
    ? (ownedSites.find((site) => site.isPrimary || site.subdomain === "main")?.id || ownedSites[0]?.id || null)
    : null;

  const plugins = await listPluginsWithState();
  const visiblePlugins = plugins.filter((plugin) => {
    if (view === "installed") return plugin.enabled;
    if (view === "uninstalled") return !plugin.enabled;
    return true;
  });
  const installedIds = await listLocalInstalledIds("plugin");
  let discoverEntries: Awaited<ReturnType<typeof listRepoCatalog>> = [];
  let discoverError = "";
  if (activeTab === "discover") {
    try {
      discoverEntries = await listRepoCatalog("plugin", query);
    } catch (error) {
      discoverError = error instanceof Error ? error.message : "Failed loading plugin catalog.";
    }
  }
  const friendlyError = toRepoCatalogFriendlyError(discoverError, errorCode);

  async function togglePlugin(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;
    const pluginId = String(formData.get("pluginId") || "");
    const pluginState = (await listPluginsWithState()).find((plugin) => plugin.id === pluginId);
    if (!pluginState) return;
    const enabledInput = formData.get("enabled");
    const mustUseInput = formData.get("networkRequired");
    const enabled = enabledInput === null ? Boolean(pluginState.enabled) : enabledInput === "on";
    const networkRequired = pluginState.scope === "network"
      ? enabled
      : mustUseInput === null
        ? Boolean(pluginState.networkRequired)
        : mustUseInput === "on";
    await setPluginEnabled(pluginId, enabled);
    await setPluginNetworkRequired(pluginId, networkRequired);
    if (singleSiteMode && mainSiteId) {
      await setSitePluginEnabled(mainSiteId, pluginId, enabled || networkRequired);
      revalidatePath(`/site/${mainSiteId}/settings/plugins`);
      revalidatePath(`/app/site/${mainSiteId}/settings/plugins`);
    }
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
  }

  async function saveConfig(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;
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

  async function installPlugin(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;
    const directory = String(formData.get("directory") || "").trim();
    if (!directory) return;
    try {
      await installFromRepo("plugin", directory);
    } catch {
      redirect("/settings/plugins?tab=discover&error=rate_limit");
    }
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
  }

  async function bulkTogglePlugins(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;
    const mode = String(formData.get("mode") || "");
    const nextEnabled = mode === "enable";
    const all = await getAvailablePlugins();
    const byId = new Map((await listPluginsWithState()).map((plugin) => [plugin.id, plugin]));
    for (const plugin of all) {
      await setPluginEnabled(plugin.id, nextEnabled);
      if (plugin.scope === "network") {
        await setPluginNetworkRequired(plugin.id, nextEnabled);
      } else {
        const current = byId.get(plugin.id);
        await setPluginNetworkRequired(plugin.id, Boolean(current?.networkRequired));
      }
      if (singleSiteMode && mainSiteId) {
        await setSitePluginEnabled(mainSiteId, plugin.id, nextEnabled);
      }
    }
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
    if (singleSiteMode && mainSiteId) {
      revalidatePath(`/site/${mainSiteId}/settings/plugins`);
      revalidatePath(`/app/site/${mainSiteId}/settings/plugins`);
    }
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

      <CatalogTabs basePath="/settings/plugins" activeTab={activeTab} />

      {activeTab === "discover" ? (
        <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <form className="flex w-full items-center justify-end gap-2">
            <input type="hidden" name="tab" value="discover" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search plugins"
              className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-white"
            />
            <button className="rounded-md border border-black bg-black px-3 py-1.5 text-xs text-white">Search</button>
          </form>
          <div className="space-y-2">
            {friendlyError ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">{friendlyError}</p>
            ) : null}
            {discoverEntries.map((entry) => {
              const alreadyInstalled = installedIds.has(entry.directory);
              return (
                <div key={entry.directory} className="flex items-start justify-between rounded-md border border-stone-200 p-3 dark:border-stone-700">
                  <div>
                    <div className="font-medium text-stone-900 dark:text-white">{entry.name}</div>
                    <div className="text-xs text-stone-500">{entry.id}</div>
                    <div className="text-xs text-stone-600 dark:text-stone-300">{entry.description}</div>
                  </div>
                  {alreadyInstalled ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Installed</span>
                  ) : (
                    <form action={installPlugin}>
                      <input type="hidden" name="directory" value={entry.directory} />
                      <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Install</button>
                    </form>
                  )}
                </div>
              );
            })}
            {discoverEntries.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">No repo plugins found for this search.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "installed" ? (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <a
            href={`/settings/plugins?tab=installed&view=all`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "all"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View All
          </a>
          <a
            href={`/settings/plugins?tab=installed&view=installed`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "installed"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Installed
          </a>
          <a
            href={`/settings/plugins?tab=installed&view=uninstalled`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "uninstalled"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Uninstalled
          </a>
        </div>
        <div className="flex items-center gap-2">
          <form action={bulkTogglePlugins}>
            <input type="hidden" name="mode" value="enable" />
            <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Enable All</button>
          </form>
          <form action={bulkTogglePlugins}>
            <input type="hidden" name="mode" value="disable" />
            <button className="rounded-md border border-stone-700 bg-stone-700 px-3 py-1 text-xs text-white">Disable All</button>
          </form>
        </div>
      </div>
      ) : null}

      {activeTab === "installed" ? (
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Plugin</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Network</th>
              <th className="px-4 py-3">Settings</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlugins.map((plugin) => (
              <tr key={plugin.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-4 py-3 align-top">
                  <div className="flex items-baseline gap-2">
                    <div className="font-medium text-stone-900 dark:text-white">{plugin.name}</div>
                    {plugin.distribution === "core" ? (
                      <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                        Core
                      </span>
                    ) : null}
                    {plugin.developer ? (
                      <div className="text-xs text-stone-500 italic">
                        by{" "}
                        {plugin.website ? (
                          <a
                            href={plugin.website}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-stone-700 dark:hover:text-stone-300"
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
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                    {(plugin.scope || "site") === "network" ? "Network" : "Site"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-stone-700 dark:text-stone-300">{plugin.version || "n/a"}</td>
                <td className="px-4 py-3 align-top">
                  <form action={togglePlugin} className="flex items-center">
                    <input type="hidden" name="pluginId" value={plugin.id} />
                    <input type="hidden" name="enabled" value={plugin.enabled ? "" : "on"} />
                    <input type="hidden" name="networkRequired" value={plugin.networkRequired ? "on" : ""} />
                    <button
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold ${
                        plugin.enabled
                          ? "border-emerald-700 bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                          : "border-stone-500 bg-stone-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                      }`}
                    >
                      Enabled
                      <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            plugin.enabled ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70"
                          }`}
                        />
                      </span>
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3 align-top">
                  {plugin.scope === "network" ? (
                    <button
                      type="button"
                      disabled
                      className={`inline-flex cursor-not-allowed items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                        plugin.networkRequired
                          ? "border-emerald-700 bg-emerald-700"
                          : "border-stone-500 bg-stone-600"
                      }`}
                    >
                      Network
                      <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            plugin.networkRequired ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70"
                          }`}
                        />
                      </span>
                    </button>
                  ) : (
                    <form action={togglePlugin} className="flex items-center">
                      <input type="hidden" name="pluginId" value={plugin.id} />
                      <input type="hidden" name="enabled" value={plugin.enabled ? "on" : ""} />
                      <button
                        type="submit"
                        name="networkRequired"
                        value={plugin.networkRequired ? "" : "on"}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold ${
                          plugin.networkRequired
                            ? "border-emerald-700 bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                            : "border-stone-500 bg-stone-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                        }`}
                      >
                        Network
                        <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              plugin.networkRequired ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70"
                            }`}
                          />
                        </span>
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  {(plugin.settingsFields || []).length > 0 && (
                    <details className="rounded-md border border-stone-200 p-2 dark:border-stone-700">
                      <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Settings</summary>
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
            {visiblePlugins.length === 0 ? (
              <tr className="border-t border-stone-200 dark:border-stone-700">
                <td colSpan={6} className="px-4 py-6 text-sm text-stone-500 dark:text-stone-400">
                  No plugins match this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}
