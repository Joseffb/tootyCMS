import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import CatalogTabs from "@/components/catalog-tabs";
import {
  getAvailablePlugins,
  listPluginsWithSiteState,
  savePluginConfig,
  setPluginNetworkRequired,
  saveSitePluginConfig,
  setPluginEnabled,
  setSitePluginEnabled,
} from "@/lib/plugin-runtime";
import { revalidatePath } from "next/cache";
import {
  installFromRepo,
  listLocalInstalledIds,
  listRepoCatalog,
  toRepoCatalogFriendlyError,
} from "@/lib/repo-catalog";
import { getAuthorizedSiteForUser, userCan } from "@/lib/authorization";
import ConfirmSubmitButton from "@/components/confirm-submit-button";
import { listSiteIdsForUser } from "@/lib/site-user-tables";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string; q?: string; error?: string; view?: string }>;
};

export default async function SitePluginSettingsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManageNetworkPlugins = await userCan("network.plugins.manage", session.user.id);
  const paramsQuery = (await searchParams) || {};
  const requestedTab = paramsQuery.tab === "discover" ? "discover" : "installed";
  const query = String(paramsQuery.q || "");
  const errorCode = String(paramsQuery.error || "");
  const view = paramsQuery.view === "installed" || paramsQuery.view === "uninstalled" ? paramsQuery.view : "all";

  const id = decodeURIComponent((await params).id);
  const site = await getAuthorizedSiteForUser(session.user.id, id, "site.settings.write");
  if (!site) notFound();
  const siteId = site.id;
  const siteIds = await listSiteIdsForUser(session.user.id);
  const singleSiteMode = siteIds.length === 1;
  const activeTab = singleSiteMode ? requestedTab : "installed";

  const pluginsAll = await listPluginsWithSiteState(site.id);
  const plugins = singleSiteMode
    ? pluginsAll
    : pluginsAll.filter((plugin) => plugin.enabled);
  const visiblePlugins = plugins.filter((plugin) => {
    const active = singleSiteMode ? plugin.enabled : plugin.siteEnabled;
    if (view === "installed") return active;
    if (view === "uninstalled") return !active;
    return true;
  });
  const showNetworkColumn = visiblePlugins.some((plugin) => plugin.networkRequired);
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

  async function toggleForSite(formData: FormData) {
    "use server";
    const siteId = String(formData.get("siteId") || "");
    const pluginId = String(formData.get("pluginId") || "");
    const enabled = formData.get("enabled") === "on";
    if (!siteId || !pluginId) return;
    const currentPluginState = pluginsAll.find((entry) => entry.id === pluginId);
    const mustUseInput = formData.get("networkRequired");
    const hasNetworkRequiredInput = formData.has("networkRequired");
    const networkRequired = currentPluginState?.scope === "network"
      ? enabled
      : mustUseInput === null
        ? Boolean(currentPluginState?.networkRequired)
        : mustUseInput === "on";
    if (singleSiteMode) {
      await setPluginEnabled(pluginId, enabled);
      await setPluginNetworkRequired(pluginId, networkRequired);
      await setSitePluginEnabled(siteId, pluginId, enabled || networkRequired);
    } else {
      if (hasNetworkRequiredInput && canManageNetworkPlugins) {
        await setPluginNetworkRequired(pluginId, networkRequired);
      }
      if (currentPluginState?.networkRequired && !canManageNetworkPlugins) return;
      const effectiveNetworkRequired = hasNetworkRequiredInput && canManageNetworkPlugins
        ? networkRequired
        : Boolean(currentPluginState?.networkRequired);
      await setSitePluginEnabled(siteId, pluginId, enabled || effectiveNetworkRequired);
    }
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
    if (!plugin || plugin.networkRequired) return;

    const nextConfig: Record<string, unknown> = {};
    for (const field of plugin.settingsFields || []) {
      nextConfig[field.key] = field.type === "checkbox" ? formData.get(field.key) === "on" : String(formData.get(field.key) || "");
    }

    if (singleSiteMode) {
      await savePluginConfig(pluginId, nextConfig);
      if ((plugin.scope || "site") === "site") {
        await saveSitePluginConfig(siteId, pluginId, nextConfig);
      }
    } else {
      await saveSitePluginConfig(siteId, pluginId, nextConfig);
    }
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
    if (singleSiteMode) {
      revalidatePath("/settings/plugins");
      revalidatePath("/app/settings/plugins");
    }
  }

  async function installPlugin(formData: FormData) {
    "use server";
    const directory = String(formData.get("directory") || "").trim();
    if (!directory) return;
    try {
      await installFromRepo("plugin", directory);
    } catch {
      redirect(`/app/site/${siteId}/settings/plugins?tab=discover&error=rate_limit`);
    }
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
    revalidatePath("/settings/plugins");
    revalidatePath("/app/settings/plugins");
  }

  async function bulkToggleForSite(formData: FormData) {
    "use server";
    const siteId = String(formData.get("siteId") || "");
    const mode = String(formData.get("mode") || "");
    const nextEnabled = mode === "enable";
    if (!siteId) return;
    const all = await getAvailablePlugins();
    const byId = new Map((await listPluginsWithSiteState(siteId)).map((plugin) => [plugin.id, plugin]));
    for (const plugin of all) {
      if (singleSiteMode) {
        await setPluginEnabled(plugin.id, nextEnabled);
        await setPluginNetworkRequired(
          plugin.id,
          plugin.scope === "network" ? nextEnabled : Boolean(byId.get(plugin.id)?.networkRequired),
        );
      }
      await setSitePluginEnabled(siteId, plugin.id, nextEnabled);
    }
    revalidatePath(`/site/${siteId}/settings/plugins`);
    revalidatePath(`/app/site/${siteId}/settings/plugins`);
    if (singleSiteMode) {
      revalidatePath("/settings/plugins");
      revalidatePath("/app/settings/plugins");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Site Plugins</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Use this page to activate plugins to add functionality to your site.
        </p>
        {singleSiteMode ? (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Single-site mode: this page is the plugin control surface. Changes update global plugin state and this site together.
          </p>
        ) : (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Note: Global plugin settings controls availability and defaults. This page controls site activation and site-specific overrides.
          </p>
        )}
      </div>

      <CatalogTabs
        basePath={`/site/${siteId}/settings/plugins`}
        activeTab={activeTab}
        enabled={singleSiteMode}
        installedLabel="Active"
      />

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
            href={`/site/${siteId}/settings/plugins?tab=installed&view=all`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "all"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View All
          </a>
          <a
            href={`/site/${siteId}/settings/plugins?tab=installed&view=installed`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "installed"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Active
          </a>
          <a
            href={`/site/${siteId}/settings/plugins?tab=installed&view=uninstalled`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "uninstalled"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Uninstalled
          </a>
        </div>
        <div className="flex items-center gap-2">
          <form action={bulkToggleForSite}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="mode" value="enable" />
            <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Enable All</button>
          </form>
          <form action={bulkToggleForSite}>
            <input type="hidden" name="siteId" value={siteId} />
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
              {showNetworkColumn ? <th className="px-4 py-3">Network</th> : null}
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
                <td className="px-4 py-3 align-top">
                  <span className="text-xs text-stone-700 dark:text-stone-300">{plugin.version || "n/a"}</span>
                </td>
                <td className="px-4 py-3 align-top">
                  {(() => {
                    const active = singleSiteMode ? plugin.enabled : plugin.siteEnabled;
                    return (
                      <form action={toggleForSite} className="flex items-center gap-2">
                        <input type="hidden" name="siteId" value={siteId} />
                        <input type="hidden" name="pluginId" value={plugin.id} />
                        <input type="hidden" name="enabled" value={(!active) ? "on" : ""} />
                        <ConfirmSubmitButton
                          label="Enabled"
                          disabled={plugin.networkRequired && !singleSiteMode && !canManageNetworkPlugins}
                          confirmMessage={
                            plugin.networkRequired && !singleSiteMode && canManageNetworkPlugins && active
                              ? "This will only disable this on this site. Use network plugins to disable network wide."
                              : undefined
                          }
                          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold ${
                            active
                              ? "border-emerald-700 bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                              : "border-stone-500 bg-stone-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <>
                            Enabled
                            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                              <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70"}`} />
                            </span>
                          </>
                        </ConfirmSubmitButton>
                      </form>
                    );
                  })()}
                  {plugin.networkRequired && !singleSiteMode && (
                    <p className="mt-2 text-xs text-stone-500">
                      {canManageNetworkPlugins
                        ? "Disabling here only affects this site."
                        : "This site cannot disable it."}
                    </p>
                  )}
                </td>
                {showNetworkColumn ? (
                  <td className="px-4 py-3 align-top">
                    {plugin.networkRequired ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-1 text-xs font-semibold text-white opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                      >
                        Network
                        <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                          <span className="h-2.5 w-2.5 rounded-full bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" />
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-stone-500">-</span>
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3 align-top">
                  {(plugin.settingsFields || []).length > 0 ? (
                    plugin.networkRequired && !singleSiteMode ? (
                      <p className="text-xs text-stone-500">Network is enabled globally. Site overrides are disabled.</p>
                    ) : !plugin.enabled && !singleSiteMode ? (
                      <p className="text-xs text-stone-500">Enable globally to configure site-level overrides.</p>
                    ) : (
                      <details className="rounded-md border border-stone-200 p-2 dark:border-stone-700">
                        <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Settings</summary>
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
            {visiblePlugins.length === 0 && (
              <tr className="border-t border-stone-200 dark:border-stone-700">
                <td colSpan={showNetworkColumn ? 6 : 5} className="px-4 py-6 text-sm text-stone-500 dark:text-stone-400">
                  No plugins match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}
