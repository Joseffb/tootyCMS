import { createDataDomain, deleteDataDomain, getAllDataDomains, setDataDomainActivation, updateDataDomain } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSiteForUser } from "@/lib/authorization";
import { DEFAULT_CORE_DOMAIN_KEYS } from "@/lib/default-data-domains";
import TypedDeleteModalSubmit from "@/components/settings/typed-delete-modal-submit";
import InlineEditableField from "@/components/settings/inline-editable-field";
import InlineCheckboxAutoSave from "@/components/settings/inline-checkbox-autosave";
import StatusToggleSubmit from "@/components/settings/status-toggle-submit";
type Props = {
  params: Promise<{
    id: string
  }>
}
export default async function SiteSettingsDomains({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const id = (await params).id;
  const site = await getAuthorizedSiteForUser(session.user.id, decodeURIComponent(id), "site.settings.write");
  if (!site) {
    notFound();
  }

  const domains = await getAllDataDomains(site.id);

  return (
    <div className="flex flex-col space-y-6">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
        <h2 className="font-cal text-xl text-stone-900">Post Types (Data Domains)</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          A data domain is a site content type (for example, Post, Page, or a custom type) with its own records,
          taxonomy usage, and rendering behavior. Changes made here apply only to this site.
        </p>

        <form
          action={async (formData) => {
            "use server";
            const label = String(formData.get("label") ?? "").trim();
            if (!label) return;
            await createDataDomain({
              label,
              siteId: site.id,
              activateForSite: true,
            });
            redirect(`/app/site/${encodeURIComponent(site.id)}/settings/domains`);
          }}
          className="mt-4 flex items-end gap-2"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300">New Post Type</label>
            <input
              name="label"
              type="text"
              placeholder="used cars"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Create & Activate
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Term / Permalink</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Usages</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Show in menu</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {domains.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-stone-500" colSpan={6}>
                  No post types yet.
                </td>
              </tr>
            ) : (
              domains.map((domain: any) => {
                const updateFormId = `domain-update-${domain.id}`;
                const statusFormId = `domain-status-${domain.id}`;
                const isCore = DEFAULT_CORE_DOMAIN_KEYS.includes(domain.key);
                return (
                  <tr key={domain.id} className="border-t border-stone-200">
                    <td className="px-4 py-2 align-top">
                      <form
                        id={updateFormId}
                        action={async (formData) => {
                          "use server";
                          const label = String(formData.get("label") ?? "").trim();
                          if (!label) return;
                          const result = await updateDataDomain({
                            id: domain.id,
                            siteId: site.id,
                            label,
                            key: String(formData.get("key") ?? "").trim(),
                            permalink: String(formData.get("permalink") ?? "").trim(),
                            description: String(formData.get("description") ?? "").trim(),
                            showInMenu: formData.get("showInMenu") === "on",
                          });
                          if (result && typeof result === "object" && "error" in result) {
                            throw new Error(String((result as { error?: string }).error || "Failed to update data domain"));
                          }
                          redirect(`/app/site/${encodeURIComponent(site.id)}/settings/domains`);
                        }}
                        className="hidden"
                      />
                      <div className="grid gap-1">
                        <InlineEditableField
                          formId={updateFormId}
                          name="label"
                          defaultValue={domain.label || ""}
                          className="text-sm font-medium text-stone-900 outline-none"
                          confirmText="Save term change?"
                        />
                        <div className="flex items-center gap-0.5 text-xs text-stone-500">
                          <span>/</span>
                          <InlineEditableField
                            formId={updateFormId}
                            name="permalink"
                            defaultValue={String(domain.permalink || "").replace(/^\/+/, "")}
                            className="inline-block text-xs text-stone-500 outline-none"
                            confirmText="Save permalink change?"
                          />
                        </div>
                        <InlineEditableField
                          formId={updateFormId}
                          name="description"
                          defaultValue={domain.description || ""}
                          multiline
                          className="text-xs leading-5 text-stone-600 outline-none"
                          confirmText="Save description change?"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top text-stone-700">
                      <InlineEditableField
                        formId={updateFormId}
                        name="key"
                        defaultValue={domain.key || ""}
                        className="text-xs text-stone-700 outline-none"
                        confirmText="Save key change? Key is always singular. Plural values are auto-converted when saved."
                      />
                    </td>
                    <td className="px-4 py-2">{domain.usageCount ?? 0}</td>
                    <td className="px-4 py-2">
                      <form
                        id={statusFormId}
                        action={async () => {
                          "use server";
                          await setDataDomainActivation({
                            siteId: site.id,
                            dataDomainId: domain.id,
                            isActive: !domain.isActive,
                          });
                          redirect(`/app/site/${encodeURIComponent(site.id)}/settings/domains`);
                        }}
                        className="hidden"
                      />
                      <StatusToggleSubmit formId={statusFormId} active={Boolean(domain.isActive)} />
                    </td>
                    <td className="px-4 py-2">
                      <InlineCheckboxAutoSave
                        formId={updateFormId}
                        name="showInMenu"
                        defaultChecked={domain?.settings?.showInMenu ?? true}
                        label="Show In Menu"
                        confirmText="Save menu visibility change?"
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      {!isCore && !domain.isActive ? (
                        <TypedDeleteModalSubmit
                          title={`Delete "${domain.label}"?`}
                          description="This will remove this Post Type from this site and delete this site's content in that type."
                          confirmWord="delete"
                          submitLabel="Delete Post Type"
                          triggerLabel="✖"
                          triggerClassName="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                          action={async (formData) => {
                            "use server";
                            await deleteDataDomain({
                              id: domain.id,
                              siteId: site.id,
                              confirmText: String(formData.get("confirm_text") || ""),
                            });
                            redirect(`/app/site/${encodeURIComponent(site.id)}/settings/domains`);
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
