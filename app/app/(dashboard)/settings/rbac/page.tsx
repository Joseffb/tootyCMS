import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createGlobalRbacRole, deleteGlobalRbacRole, getGlobalRbacSettingsAdmin, listUsersAdmin, updateGlobalRbacCapability, updateUserAdmin } from "@/lib/actions";
import RbacAssignmentsTable from "@/components/settings/rbac-assignments-table";
import RbacRoleControls from "@/components/settings/rbac-role-controls";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RbacSettingsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await getGlobalRbacSettingsAdmin();
  const users = await listUsersAdmin().catch(() => []);
  const params = (await searchParams) || {};
  const tab = params.tab === "matrix" ? "matrix" : "roles";
  const requestedRole = String(params.role || "").trim().toLowerCase();
  const selectedRole = settings.roles.includes(requestedRole) ? requestedRole : (settings.roles[0] || "administrator");
  const systemRoleSet = new Set<string>(settings.systemRoles as readonly string[]);
  const canDeleteSelected = !systemRoleSet.has(selectedRole);

  async function updateUserRoleAction(formData: FormData) {
    "use server";
    await updateUserAdmin(formData);
  }

  async function createRoleAction(formData: FormData) {
    "use server";
    await createGlobalRbacRole(formData);
  }

  async function openRoleAction(formData: FormData) {
    "use server";
    await createGlobalRbacRole(formData);
    const role = String(formData.get("role") || "").trim().toLowerCase();
    if (!role) redirect("/app/settings/rbac?tab=matrix");
    redirect(`/app/settings/rbac?tab=matrix&role=${encodeURIComponent(role)}`);
  }

  async function deleteRoleAction(formData: FormData) {
    "use server";
    await deleteGlobalRbacRole(formData);
    redirect("/app/settings/rbac?tab=matrix");
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Role-Based Access Control (RBAC) Capability Matrix</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Network-level role capabilities. Site-level membership uses these capabilities as gates for site actions.
      </p>

      <div className="mt-5 flex items-center gap-2 border-b border-stone-200 pb-3 dark:border-stone-700">
        <Link
          href="/app/settings/rbac?tab=roles"
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            tab === "roles"
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          Assignments
        </Link>
        <Link
          href={`/app/settings/rbac?tab=matrix&role=${encodeURIComponent(selectedRole)}`}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            tab === "matrix"
              ? "border-black bg-black text-white dark:border-stone-200 dark:bg-stone-200 dark:text-black"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-black dark:text-stone-300 dark:hover:bg-stone-900"
          }`}
        >
          Access Control
        </Link>
      </div>

      {tab === "matrix" ? (
        <>
          <RbacRoleControls
            roles={settings.roles}
            selectedRole={selectedRole}
            canDeleteSelected={canDeleteSelected}
            onOpenRole={openRoleAction}
            onDeleteRole={deleteRoleAction}
          />

          <div className="mt-5 space-y-6">
            <div className="max-w-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Editing</p>
              <p className="mt-1 text-sm font-semibold text-stone-900 capitalize dark:text-white">{selectedRole}</p>
            </div>

            <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-stone-50 dark:bg-stone-900">
                  <tr>
                    <th className="px-3 py-2 text-left">Capability</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.capabilities.map((capability) => {
                    const enabled = Boolean(settings.matrix[selectedRole]?.[capability]);
                    return (
                      <tr key={capability} className="border-t border-stone-200 dark:border-stone-700">
                        <td className="px-3 py-2 font-mono text-xs">{capability}</td>
                        <td className="px-3 py-2">
                          <form action={updateGlobalRbacCapability}>
                            <input type="hidden" name="selectedRole" value={selectedRole} />
                            <input type="hidden" name="capability" value={capability} />
                            <input type="hidden" name="enabled" value={enabled ? "" : "on"} />
                            <button
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold ${
                                enabled
                                  ? "border-emerald-700 bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                                  : "border-stone-500 bg-stone-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                              }`}
                            >
                              Enabled
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    enabled ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]" : "bg-stone-300/70"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === "roles" ? (
      <div className="mt-8 border-t border-stone-200 pt-6 dark:border-stone-700">
        <h3 className="text-lg font-semibold dark:text-white">Role Assignments</h3>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Assign each global user to a role used by this capability matrix.
        </p>
        <RbacAssignmentsTable users={users as any} roles={settings.roles} onUpdate={updateUserRoleAction} />
      </div>
      ) : null}
    </div>
  );
}
