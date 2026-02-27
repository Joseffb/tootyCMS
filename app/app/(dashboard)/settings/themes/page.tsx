import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listThemesWithState, saveThemeConfig, setThemeEnabled } from "@/lib/themes";
import { revalidatePath } from "next/cache";
import CatalogTabs from "@/components/catalog-tabs";
import {
  installFromRepo,
  listLocalInstalledIds,
  listRepoCatalog,
  toRepoCatalogFriendlyError,
} from "@/lib/repo-catalog";
import { userCan } from "@/lib/authorization";

type Props = {
  searchParams?: Promise<{ tab?: string; q?: string; error?: string; view?: string }>;
};

export default async function ThemeSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManageNetworkThemes = await userCan("network.themes.manage", session.user.id);
  if (!canManageNetworkThemes) redirect("/app");
  const params = (await searchParams) || {};
  const activeTab = params.tab === "discover" ? "discover" : "installed";
  const query = String(params.q || "");
  const errorCode = String(params.error || "");
  const view = params.view === "enabled" || params.view === "disabled" ? params.view : "all";

  const themes = await listThemesWithState();
  const visibleThemes = themes.filter((theme) => {
    if (view === "enabled") return theme.enabled;
    if (view === "disabled") return !theme.enabled;
    return true;
  });
  const installedIds = await listLocalInstalledIds("theme");
  let discoverEntries: Awaited<ReturnType<typeof listRepoCatalog>> = [];
  let discoverError = "";
  if (activeTab === "discover") {
    try {
      discoverEntries = await listRepoCatalog("theme", query);
    } catch (error) {
      discoverError = error instanceof Error ? error.message : "Failed loading theme catalog.";
    }
  }
  const friendlyError = toRepoCatalogFriendlyError(discoverError, errorCode);

  async function toggleTheme(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.themes.manage", current.user.id);
    if (!allowed) return;
    const themeId = String(formData.get("themeId") || "");
    const enabled = formData.get("enabled") === "on";
    await setThemeEnabled(themeId, enabled);
    revalidatePath("/settings/themes");
    revalidatePath("/app/settings/themes");
  }

  async function saveConfig(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.themes.manage", current.user.id);
    if (!allowed) return;
    const themeId = String(formData.get("themeId") || "");
    const theme = (await listThemesWithState()).find((t) => t.id === themeId);
    if (!theme) return;

    const config: Record<string, unknown> = {};
    for (const field of theme.settingsFields || []) {
      config[field.key] = field.type === "checkbox" ? formData.get(field.key) === "on" : String(formData.get(field.key) || "");
    }

    await saveThemeConfig(themeId, config);
    revalidatePath("/settings/themes");
    revalidatePath("/app/settings/themes");
  }

  async function installTheme(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current) return;
    const allowed = await userCan("network.themes.manage", current.user.id);
    if (!allowed) return;
    const directory = String(formData.get("directory") || "").trim();
    if (!directory) return;
    try {
      await installFromRepo("theme", directory);
    } catch {
      redirect("/app/settings/themes?tab=discover&error=rate_limit");
    }
    revalidatePath("/settings/themes");
    revalidatePath("/app/settings/themes");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Themes are discovered from configured paths (comma-separated in `THEMES_PATH`) and managed here.
      </p>
      <CatalogTabs basePath="/settings/themes" activeTab={activeTab} />

      {activeTab === "discover" ? (
        <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-black">
          <form className="flex w-full items-center justify-end gap-2">
            <input type="hidden" name="tab" value="discover" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search themes"
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
                  <div className="flex items-start gap-3">
                    <div className="h-20 w-36 overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900">
                      {entry.thumbnailUrl ? (
                        <img
                          src={entry.thumbnailUrl}
                          alt={`${entry.name} thumbnail`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[11px] text-stone-500">No thumbnail</div>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-stone-900 dark:text-white">{entry.name}</div>
                      <div className="text-xs text-stone-500">{entry.id}</div>
                      <div className="text-xs text-stone-600 dark:text-stone-300">{entry.description}</div>
                    </div>
                  </div>
                  {alreadyInstalled ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Installed</span>
                  ) : (
                    <form action={installTheme}>
                      <input type="hidden" name="directory" value={entry.directory} />
                      <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Install</button>
                    </form>
                  )}
                </div>
              );
            })}
            {discoverEntries.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">No repo themes found for this search.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "installed" ? (
      <div className="flex items-center gap-2">
        <Link
          href="/settings/themes?tab=installed&view=all"
          className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
            view === "all"
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          View All
        </Link>
        <Link
          href="/settings/themes?tab=installed&view=enabled"
          className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
            view === "enabled"
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          View Enabled
        </Link>
        <Link
          href="/settings/themes?tab=installed&view=disabled"
          className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
            view === "disabled"
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          View Disabled
        </Link>
      </div>
      ) : null}

      {activeTab === "installed" ? (
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-black">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-700 dark:bg-stone-900 dark:text-stone-200">
            <tr>
              <th className="px-4 py-3">Theme</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleThemes.map((theme) => (
              <tr key={theme.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-stone-900 dark:text-white">{theme.name}</div>
                  <div className="text-xs text-stone-500">{theme.id}</div>
                  <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">{theme.description}</div>
                </td>
                <td className="px-4 py-3 align-top text-stone-700 dark:text-stone-300">{theme.version || "n/a"}</td>
                <td className="px-4 py-3 align-top">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${theme.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"}`}>
                    {theme.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <form action={toggleTheme} className="flex items-center gap-2">
                    <input type="hidden" name="themeId" value={theme.id} />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="enabled" defaultChecked={theme.enabled} className="h-4 w-4" />
                      <span className="text-xs text-stone-600 dark:text-stone-300">Enabled</span>
                    </label>
                    <button className="rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Save</button>
                  </form>

                  {(theme.settingsFields || []).length > 0 && (
                    <details className="mt-3 rounded-md border border-stone-200 p-2 dark:border-stone-700">
                      <summary className="cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300">Theme settings</summary>
                      <form action={saveConfig} className="mt-2 grid gap-2">
                        <input type="hidden" name="themeId" value={theme.id} />
                        {(theme.settingsFields || []).map((field) => (
                          <label key={field.key} className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-stone-700 dark:text-stone-300">{field.label}</span>
                            {field.type === "checkbox" ? (
                              <input type="checkbox" name={field.key} defaultChecked={Boolean(theme.config[field.key])} className="h-4 w-4" />
                            ) : field.type === "textarea" ? (
                              <textarea name={field.key} defaultValue={String(theme.config[field.key] || "")} className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white" />
                            ) : (
                              <input type={field.type || "text"} name={field.key} defaultValue={String(theme.config[field.key] || "")} className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:bg-black dark:text-white" />
                            )}
                          </label>
                        ))}
                        <button className="w-fit rounded-md border border-black bg-black px-3 py-1 text-xs text-white">Save Theme Settings</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}
