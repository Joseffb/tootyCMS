import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { listThemesWithState, getSiteThemeId, saveThemeConfig, setSiteTheme } from "@/lib/themes";
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import { revalidatePath, revalidateTag } from "next/cache";
import SiteThemeSettingsModal from "@/components/site-theme-settings-modal";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteThemeSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const id = decodeURIComponent((await params).id);
  const site = await db.query.sites.findFirst({ where: (sites, { eq }) => eq(sites.id, id) });
  if (!site || site.userId !== session.user.id) notFound();
  const siteData = site;

  const [themes, activeThemeId] = await Promise.all([listThemesWithState(), getSiteThemeId(siteData.id)]);
  const enabledThemes = themes.filter((theme) => theme.enabled);
  const selectedThemeId =
    enabledThemes.some((theme) => theme.id === activeThemeId)
      ? activeThemeId
      : (enabledThemes[0]?.id ?? "");

  async function saveTheme(formData: FormData) {
    "use server";
    const themeId = String(formData.get("themeId") || "");
    if (!themeId) return;
    const availableThemes = await listThemesWithState();
    const selected = availableThemes.find((theme) => theme.id === themeId && theme.enabled);
    if (!selected) return;

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

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Site Theme</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Choose from enabled themes. Add `thumbnail.png` to the root of each theme folder for preview.
        </p>
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
              {enabledThemes.map((theme) => (
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
                            ? "border-emerald-700 bg-emerald-700 text-white"
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
      </div>
    </div>
  );
}
