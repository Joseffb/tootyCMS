import { createDataDomain, deleteDataDomain, getAllDataDomains, setDataDomainActivation, updateDataDomain } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSiteForUser } from "@/lib/authorization";
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
          Activate Data Domains per site.
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
              <th className="px-4 py-2 font-medium">Post Type</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Usages</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Domain CRUD</th>
            </tr>
          </thead>
          <tbody>
            {domains.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-stone-500" colSpan={5}>
                  No post types yet.
                </td>
              </tr>
            ) : (
              domains.map((domain: any) => (
                <tr key={domain.id} className="border-t border-stone-200">
                  <td className="px-4 py-2">{domain.label}</td>
                  <td className="px-4 py-2 text-stone-500">{domain.key}</td>
                  <td className="px-4 py-2">{domain.usageCount ?? 0}</td>
                  <td className="px-4 py-2">
                    {domain.isActive ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Active</span>
                    ) : (
                      <span className="rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        action={async (formData) => {
                          "use server";
                          const label = String(formData.get("label") ?? "").trim();
                          if (!label) return;
                          await updateDataDomain({ id: domain.id, label });
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          name="label"
                          type="text"
                          defaultValue={domain.label}
                          className="w-36 rounded border border-stone-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                        >
                          Update
                        </button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await setDataDomainActivation({
                            siteId: site.id,
                            dataDomainId: domain.id,
                            isActive: !domain.isActive,
                          });
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                        >
                          {domain.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await deleteDataDomain(domain.id);
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
