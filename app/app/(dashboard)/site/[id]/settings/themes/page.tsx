import { getSession } from "@/lib/auth";
import { listThemesWithState, getSiteThemeId, saveThemeConfig, setSiteTheme, setThemeEnabled } from "@/lib/themes";
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import { revalidatePath, revalidateTag } from "next/cache";
import SiteThemeSettingsModal from "@/components/site-theme-settings-modal";
import CatalogTabs from "@/components/catalog-tabs";
import {
  installFromRepo,
  listLocalInstalledIds,
  listRepoCatalog,
  toRepoCatalogFriendlyError,
} from "@/lib/repo-catalog";
import { getAuthorizedSiteForUser } from "@/lib/authorization";
import { listSiteIdsForUser } from "@/lib/site-user-tables";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string; q?: string; error?: string; view?: string }>;
};

export default async function SiteThemeSettingsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");
  const paramsQuery = (await searchParams) || {};
  const requestedTab = paramsQuery.tab === "discover" ? "discover" : "installed";
  const query = String(paramsQuery.q || "");
  const errorCode = String(paramsQuery.error || "");
  const view = paramsQuery.view === "active" || paramsQuery.view === "inactive" ? paramsQuery.view : "all";

  const id = decodeURIComponent((await params).id);
  const site = await getAuthorizedSiteForUser(session.user.id, id, "site.settings.write");
  if (!site) notFound();
  const siteData = site;
  const siteIds = await listSiteIdsForUser(session.user.id);
  const singleSiteMode = siteIds.length === 1;
  const activeTab = singleSiteMode ? requestedTab : "installed";

  const [themes, activeThemeId] = await Promise.all([listThemesWithState(), getSiteThemeId(siteData.id)]);
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
  const selectableThemes = singleSiteMode ? themes : themes.filter((theme) => theme.enabled);
  const selectedThemeId = selectableThemes.some((theme) => theme.id === activeThemeId)
    ? activeThemeId
    : (selectableThemes[0]?.id ?? "");
  const visibleThemes = selectableThemes.filter((theme) => {
    const active = theme.id === selectedThemeId;
    if (view === "active") return active;
    if (view === "inactive") return !active;
    return true;
  });

  async function saveTheme(formData: FormData) {
    "use server";
    const themeId = String(formData.get("themeId") || "");
    if (!themeId) return;
    const availableThemes = await listThemesWithState();
    const selected = availableThemes.find((theme) => theme.id === themeId && (singleSiteMode || theme.enabled));
    if (!selected) return;
    if (singleSiteMode && !selected.enabled) {
      await setThemeEnabled(themeId, true);
    }

    await setSiteTheme(siteData.id, themeId);

    const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").replace(/:\d+$/, "");
    const tagDomains = [
      siteData.subdomain ? `${siteData.subdomain}.${rootDomain}` : "",
      siteData.customDomain || "",
    ].filter(Boolean);

    for (const domain of tagDomains) {
      revalidateTag(`${domain}-metadata`, "max");
      revalidateTag(`${domain}-posts`, "max");
    }

    revalidatePath(`/app/site/${siteData.id}/settings/themes`);
    revalidatePath("/", "layout");
    revalidatePath("/[domain]", "layout");
    revalidatePath("/[domain]/[slug]", "page");
    revalidatePath("/[domain]/c/[slug]", "page");
    redirect(`/app/site/${siteData.id}/settings/themes`);
  }

  async function saveThemeSettings(formData: FormData) {
    "use server";
    const themeId = String(formData.get("themeId") || "");
    const theme = (await listThemesWithState()).find((t) => t.id === themeId);
    if (!theme) return;

    const config: Record<string, unknown> = { ...(theme.config || {}) };
    for (const field of theme.settingsFields || []) {
      config[field.key] = field.type === "checkbox" ? formData.get(field.key) === "on" : String(formData.get(field.key) || "");
    }

    await saveThemeConfig(themeId, config);
    revalidatePath(`/app/site/${siteData.id}/settings/themes`);
    revalidatePath("/", "layout");
    revalidatePath("/[domain]", "layout");
    revalidatePath("/[domain]/[slug]", "page");
    revalidatePath("/[domain]/c/[slug]", "page");
    revalidatePath("/[domain]/t/[slug]", "page");
    redirect(`/app/site/${siteData.id}/settings/themes`);
  }

  async function installTheme(formData: FormData) {
    "use server";
    const directory = String(formData.get("directory") || "").trim();
    if (!directory) return;
    try {
      await installFromRepo("theme", directory);
    } catch {
      redirect(`/app/site/${siteData.id}/settings/themes?tab=discover&error=rate_limit`);
    }
    revalidatePath(`/site/${siteData.id}/settings/themes`);
    revalidatePath(`/app/site/${siteData.id}/settings/themes`);
    revalidatePath("/settings/themes");
    revalidatePath("/app/settings/themes");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Site Theme</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {singleSiteMode
            ? "Single-site mode: choose from all available themes."
            : "Choose from enabled themes."}{" "}
          Add `thumbnail.png` to the root of each theme folder for preview.
        </p>
        <div className="mt-4">
          <CatalogTabs
            basePath={`/site/${siteData.id}/settings/themes`}
            activeTab={activeTab}
            enabled={singleSiteMode}
          />
        </div>
        {activeTab === "discover" ? (
          <div className="mt-4 space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-700">
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
        ) : null}
        {activeTab === "installed" ? (
        <div className="mt-4 flex items-center gap-2">
          <a
            href={`/site/${siteData.id}/settings/themes?tab=installed&view=all`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "all"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View All
          </a>
          <a
            href={`/site/${siteData.id}/settings/themes?tab=installed&view=active`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "active"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Active
          </a>
          <a
            href={`/site/${siteData.id}/settings/themes?tab=installed&view=inactive`}
            className={`no-underline rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === "inactive"
                ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
            }`}
          >
            View Inactive
          </a>
        </div>
        ) : null}
        {activeTab === "installed" ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left dark:bg-stone-900">
              <tr>
                <th className="px-5 py-3 font-medium">Preview</th>
                <th className="px-5 py-3 font-medium">Theme</th>
                <th className="px-5 py-3 font-medium">Select</th>
              </tr>
            </thead>
            <tbody>
              {visibleThemes.map((theme) => (
                <tr key={theme.id} className="border-t border-stone-200 dark:border-stone-700">
                  <td className="px-5 py-6 align-top">
                    <div className="relative h-48 w-80 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900">
                      <Image
                        src={`/theme-assets/${theme.id}/thumbnail.png`}
                        alt={`${theme.name} thumbnail`}
                        fill
                        className="object-cover"
                        sizes="320px"
                        unoptimized
                      />
                    </div>
                  </td>
                  <td className="px-5 py-6 align-top">
                    <div className="font-medium text-stone-900 dark:text-white">{theme.name}</div>
                    <div className="text-xs text-stone-500">{theme.id}</div>
                    {theme.description ? (
                      <p className="mt-1 max-w-md text-xs text-stone-600 dark:text-stone-300">{theme.description}</p>
                    ) : null}
                    {selectedThemeId === theme.id && (theme.settingsFields || []).length > 0 ? (
                      <SiteThemeSettingsModal
                        themeId={theme.id}
                        themeName={theme.name}
                        fields={theme.settingsFields || []}
                        config={theme.config || {}}
                        action={saveThemeSettings}
                      />
                    ) : null}
                  </td>
                  <td className="px-5 py-6 align-top">
                    <form action={saveTheme} className="flex items-center gap-2">
                      <input type="hidden" name="themeId" value={theme.id} />
                      <button
                        className={`rounded-md border px-3 py-1.5 text-xs ${
                          selectedThemeId === theme.id
                            ? "!border-stone-300 !bg-white !text-black"
                            : "border-black bg-black text-white hover:bg-white hover:text-black"
                        }`}
                      >
                        {selectedThemeId === theme.id ? "Selected" : "Use Theme"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : null}
      </div>
    </div>
  );
}
