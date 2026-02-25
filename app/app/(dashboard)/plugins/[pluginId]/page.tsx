import { getSession } from "@/lib/auth";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { sendCommunication } from "@/lib/communications";

type Props = {
  params: Promise<{ pluginId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PluginSetupPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const resolvedSearchParams = (await searchParams) || {};
  const tab = String(resolvedSearchParams.tab || "settings").trim().toLowerCase();
  const pluginId = decodeURIComponent((await params).pluginId);
  const plugin = await getPluginById(pluginId);
  if (!plugin) notFound();
  const pluginData = plugin;

  const config = await getPluginConfig(pluginData.id);
  const isDevTools = pluginData.id === "dev-tools";
  const canUseSendMessageTool = await userCan("network.plugins.manage", session.user.id);
  const kernel = await createKernelForRequest();
  const providers = kernel.getAllPluginCommunicationProviders().map((provider) => ({
    id: `${provider.pluginId}:${provider.id}`,
    label: `${provider.pluginId}:${provider.id}`,
    channels: provider.channels,
  }));

  async function sendMessage(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) throw new Error("Not authenticated.");
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) throw new Error("Network admin required.");

    const providerId = String(formData.get("providerId") || "").trim();
    const from = String(formData.get("from") || "").trim();
    const to = String(formData.get("to") || "").trim();
    const cc = String(formData.get("cc") || "").trim();
    const bcc = String(formData.get("bcc") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const subject = String(formData.get("subject") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!to) throw new Error("To is required.");
    if (!body) throw new Error("Body is required.");

    await sendCommunication(
      {
        channel: "email",
        to,
        subject,
        body,
        category: "transactional",
        metadata: {
          from,
          cc,
          bcc,
          replyTo,
          preferredProvider: providerId,
          sentFrom: "dev-tools:send-message",
        },
      },
      { createdByUserId: current.user.id },
    );
  }

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
      {pluginData.developer ? (
        <p className="text-xs text-stone-500 italic">
          by{" "}
          {pluginData.website ? (
            <a href={pluginData.website} target="_blank" rel="noreferrer">
              {pluginData.developer}
            </a>
          ) : (
            pluginData.developer
          )}
        </p>
      ) : null}
      <p className="text-sm text-stone-600">{pluginData.description}</p>

      {isDevTools ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2 dark:border-stone-700">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-600 dark:bg-stone-900 dark:text-white"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=send-message`}
              className={`rounded border px-3 py-1 text-sm ${tab === "send-message" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-600 dark:bg-stone-900 dark:text-white"}`}
            >
              Send Message
            </Link>
          </div>

          {tab === "send-message" ? (
            canUseSendMessageTool ? (
              <form action={sendMessage} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
                <h2 className="font-cal text-xl dark:text-white">Send Message</h2>
                <p className="text-xs text-stone-500">Network-admin test compose tool for communication providers.</p>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Provider</span>
                  <select name="providerId" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white">
                    <option value="">Auto select (by channel)</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label} [{provider.channels.join(", ")}]
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">From</span>
                  <input name="from" placeholder="noreply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">To</span>
                  <input name="to" required placeholder="recipient@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">CC</span>
                  <input name="cc" placeholder="cc@example.com, cc2@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">BCC</span>
                  <input name="bcc" placeholder="bcc@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Reply-To</span>
                  <input name="replyTo" placeholder="reply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Subject</span>
                  <input name="subject" placeholder="Message subject" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Body</span>
                  <textarea name="body" required rows={8} placeholder="Compose message..." className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <button className="w-fit rounded-md border border-black bg-black px-3 py-2 text-sm text-white">Send Message</button>
              </form>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Network admin permission is required to use Send Message.
              </div>
            )
          ) : (pluginData.settingsFields || []).length > 0 ? (
            <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
              {(pluginData.settingsFields || []).map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800">{field.label}</span>
                  {field.type === "checkbox" ? (
                    <input type="checkbox" name={field.key} defaultChecked={Boolean(config[field.key])} className="h-4 w-4" />
                  ) : field.type === "select" ? (
                    <select
                      name={field.key}
                      defaultValue={String(config[field.key] || field.defaultValue || "")}
                      className="rounded-md border border-stone-300 px-2 py-1"
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
                  {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                    <span className="text-xs text-stone-500">{field.helpText}</span>
                  ) : null}
                </label>
              ))}
              <button className="w-fit rounded-md border border-black bg-black px-3 py-2 text-sm text-white">Save</button>
            </form>
          ) : (
            <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
          )}
        </>
      ) : (pluginData.settingsFields || []).length > 0 ? (
        <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
          {(pluginData.settingsFields || []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-800">{field.label}</span>
              {field.type === "checkbox" ? (
                <input type="checkbox" name={field.key} defaultChecked={Boolean(config[field.key])} className="h-4 w-4" />
              ) : field.type === "select" ? (
                <select
                  name={field.key}
                  defaultValue={String(config[field.key] || field.defaultValue || "")}
                  className="rounded-md border border-stone-300 px-2 py-1"
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
              {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                <span className="text-xs text-stone-500">{field.helpText}</span>
              ) : null}
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
