import { getSession } from "@/lib/auth";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { sendCommunication } from "@/lib/communications";
import MigrationKitConsole from "@/components/migration-kit-console";

type Props = {
  params: Promise<{ pluginId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PluginSetupPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const resolvedSearchParams = (await searchParams) || {};
  const tab = String(resolvedSearchParams.tab || "settings").trim().toLowerCase();
  const selectedSiteId = String(resolvedSearchParams.siteId || "").trim();
  const pluginId = decodeURIComponent((await params).pluginId);
  const plugin = await getPluginById(pluginId);
  if (!plugin) notFound();
  const pluginData = plugin;
  const config = (await getPluginConfig(pluginData.id)) as Record<string, unknown>;
  const migrationRedirectSuffix = selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : "";

  const isDevTools = pluginData.id === "dev-tools";
  const isMigrationKit = pluginData.id === "export-import";
  const canUseSendMessageTool = await userCan("network.plugins.manage", session.user.id);
  const kernel = await createKernelForRequest(selectedSiteId || undefined);
  const providers = kernel.getAllPluginCommunicationProviders().map((provider) => ({
    id: `${provider.pluginId}:${provider.id}`,
    label: `${provider.pluginId}:${provider.id}`,
    channels: provider.channels,
  }));
  const migrationResponse = isMigrationKit
      ? await kernel.applyFilters<Response | null>("domain:query", null, {
        name: "export_import.providers",
        params: { siteId: selectedSiteId || undefined },
      })
    : null;
  const migrationProviderPayload =
    migrationResponse && migrationResponse.ok
      ? ((await migrationResponse.json().catch(() => null)) as {
          providers?: Array<{
            id: string;
            label: string;
            version?: string;
            source?: string;
            enabled?: boolean;
            networkRequired?: boolean;
            capabilities?: { export?: boolean; import?: boolean; inspect?: boolean; apply?: boolean };
          }>;
        } | null)
      : null;
  const migrationProviders = Array.isArray(migrationProviderPayload?.providers)
    ? migrationProviderPayload.providers
    : [];

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
    revalidatePath(`/plugins/${pluginData.id}`);
    revalidatePath(`/app/plugins/${pluginData.id}`);
    redirect(`/app/plugins/${pluginData.id}?tab=settings&saved=1`);
  }

  async function toggleMigrationProvider(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextEnabled = String(formData.get("enabled") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawDisabled = currentConfig.disabledProviders;
    const rawRequired = currentConfig.networkRequiredProviders;
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextEnabled) disabled.delete(providerId);
    else {
      disabled.add(providerId);
      // Mirror plugin network behavior: disabled providers cannot remain network-required.
      requiredSet.delete(providerId);
    }

    await savePluginConfig("export-import", {
      ...currentConfig,
      disabledProviders: Array.from(disabled.values()),
      networkRequiredProviders: Array.from(requiredSet.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
  }

  async function toggleMigrationProviderNetworkRequired(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextRequired = String(formData.get("required") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawRequired = currentConfig.networkRequiredProviders;
    const rawDisabled = currentConfig.disabledProviders;
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextRequired) {
      requiredSet.add(providerId);
      // Mirror plugin network behavior: network-required implies enabled.
      disabled.delete(providerId);
    }
    else requiredSet.delete(providerId);

    await savePluginConfig("export-import", {
      ...currentConfig,
      networkRequiredProviders: Array.from(requiredSet.values()),
      disabledProviders: Array.from(disabled.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
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

      {isMigrationKit ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings${selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=providers${selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "providers" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Providers
            </Link>
          </div>

          {tab === "providers" ? (
            <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 text-black">
              <div>
                <h2 className="font-cal text-xl text-black">Child Providers</h2>
                <p className="text-xs text-black">
                  Child plugins install normally, then appear here for enable/disable control.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-white text-left text-black">
                    <tr>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Capabilities</th>
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2">Network</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrationProviders.map((provider) => (
                      <tr key={provider.id} className="border-t border-stone-200">
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-black">{provider.label || provider.id}</p>
                          <p className="text-xs text-black">{provider.id}</p>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {(provider.source || "plugin").toString()}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {[
                            provider.capabilities?.export ? "export" : null,
                            provider.capabilities?.import ? "import" : null,
                            provider.capabilities?.inspect ? "inspect" : null,
                            provider.capabilities?.apply ? "apply" : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProvider}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="enabled" value={provider.enabled === false ? "on" : ""} />
                            <button
                              type="submit"
                              title={provider.enabled === false ? "Enable provider" : "Disable provider"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.enabled === false
                                  ? "border-stone-500 bg-stone-600"
                                  : "border-emerald-700 bg-emerald-700"
                              }`}
                            >
                              {provider.enabled === false ? "Disabled" : "Enabled"}
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.enabled === false
                                      ? "bg-stone-300/70"
                                      : "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProviderNetworkRequired}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="required" value={provider.networkRequired === true ? "" : "on"} />
                            <button
                              type="submit"
                              title={provider.networkRequired === true ? "Set provider as optional" : "Set provider as network required"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.networkRequired === true
                                  ? "border-emerald-700 bg-emerald-700"
                                  : "border-stone-500 bg-stone-600"
                              }`}
                            >
                              Network
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.networkRequired === true
                                      ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                      : "bg-stone-300/70"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {migrationProviders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-sm text-black">
                          No providers registered yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <MigrationKitConsole siteId={selectedSiteId || null} providers={migrationProviders} />
          )}
        </>
      ) : isDevTools ? (
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
                <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Send Message</button>
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
                    <input
                      type="checkbox"
                      name={field.key}
                      defaultChecked={
                        config[field.key] === undefined || config[field.key] === null
                          ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                          : Boolean(config[field.key])
                      }
                      className="h-4 w-4"
                    />
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
              <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
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
                <input
                  type="checkbox"
                  name={field.key}
                  defaultChecked={
                    config[field.key] === undefined || config[field.key] === null
                      ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                      : Boolean(config[field.key])
                  }
                  className="h-4 w-4"
                />
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
          <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
        </form>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
      )}
    </div>
  );
}
