import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listThemesWithState, saveThemeConfig, setThemeEnabled } from "@/lib/themes";
import { revalidatePath } from "next/cache";

export default async function ThemeSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const themes = await listThemesWithState();

  async function toggleTheme(formData: FormData) {
    "use server";
    const themeId = String(formData.get("themeId") || "");
    const enabled = formData.get("enabled") === "on";
    await setThemeEnabled(themeId, enabled);
    revalidatePath("/settings/themes");
    revalidatePath("/app/settings/themes");
  }

  async function saveConfig(formData: FormData) {
    "use server";
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Drop themes into <code>/themes/&lt;theme-id&gt;/theme.json</code> and manage them here.
      </p>

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
            {themes.map((theme) => (
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
    </div>
  );
}
