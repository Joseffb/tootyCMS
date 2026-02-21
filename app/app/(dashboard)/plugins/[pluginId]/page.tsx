import { getSession } from "@/lib/auth";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{ pluginId: string }>;
};

export default async function PluginSetupPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const pluginId = decodeURIComponent((await params).pluginId);
  const plugin = await getPluginById(pluginId);
  if (!plugin) notFound();
  const pluginData = plugin;

  const config = await getPluginConfig(pluginData.id);

  async function save(formData: FormData) {
    "use server";
    const nextConfig: Record<string, unknown> = {};
    for (const field of pluginData.settingsFields || []) {
      if (field.type === "checkbox") {
        nextConfig[field.key] = formData.get(field.key) === "on";
      } else {
        nextConfig[field.key] = String(formData.get(field.key) || "");
      }
    }
    await savePluginConfig(pluginData.id, nextConfig);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="font-cal text-3xl font-bold">{pluginData.name}</h1>
      <p className="text-sm text-stone-600">{pluginData.description}</p>

      {(pluginData.settingsFields || []).length > 0 ? (
        <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
          {(pluginData.settingsFields || []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-800">{field.label}</span>
              {field.type === "checkbox" ? (
                <input type="checkbox" name={field.key} defaultChecked={Boolean(config[field.key])} className="h-4 w-4" />
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              ) : (
                <input
                  type={field.type || "text"}
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              )}
              {field.helpText && <span className="text-xs text-stone-500">{field.helpText}</span>}
            </label>
          ))}
          <button className="w-fit rounded-md border border-black bg-black px-3 py-2 text-sm text-white">Save</button>
        </form>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
      )}
    </div>
  );
}
