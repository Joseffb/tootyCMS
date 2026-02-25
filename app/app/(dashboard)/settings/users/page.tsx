import { getSession } from "@/lib/auth";
import UsersTable from "@/components/settings/users-table";
import { redirect } from "next/navigation";
import { userCan } from "@/lib/authorization";
import {
  createUserAdmin,
  deleteUserAdmin,
  listUsersAdmin,
  startUserMimicAdmin,
  updateUserAdmin,
} from "@/lib/actions";
import { listRbacRoles } from "@/lib/rbac";

export default async function UsersSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const allowed = await userCan("network.users.manage", session.user.id);
  if (!allowed) redirect("/app");

  const users = await listUsersAdmin().catch(() => []);
  const roles = await listRbacRoles().catch(() => []);
  const roleOptions = roles.length > 0 ? roles.map((row) => row.role) : ["network admin", "administrator", "editor", "author"];

  async function createUserAdminAction(formData: FormData) {
    "use server";
    await createUserAdmin(formData);
  }

  async function updateUserAdminAction(formData: FormData) {
    "use server";
    await updateUserAdmin(formData);
  }

  async function deleteUserAdminAction(formData: FormData) {
    "use server";
    await deleteUserAdmin(formData);
  }

  async function mimicUserAdminAction(formData: FormData) {
    "use server";
    await startUserMimicAdmin(formData);
  }

  return (
    <div className="flex flex-col space-y-8">
      <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Users (Admin)</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Manage global users and roles. Profile identity/auth is managed in Profile settings.
        </p>

        <details className="mt-6 rounded-md border border-stone-200 dark:border-stone-700">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-200">
            + Add User
          </summary>
          <form action={createUserAdminAction} className="grid gap-4 border-t border-stone-200 p-4 dark:border-stone-700">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Name</label>
                <input
                  name="name"
                  placeholder="Full name"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Email</label>
                <input
                  name="email"
                  type="email"
                  placeholder="email@domain.com"
                  required
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Temporary password (optional)</label>
                <input
                  name="password"
                  type="password"
                  placeholder="8+ chars"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Role</label>
                <select
                  name="role"
                  defaultValue="author"
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                >
                  {roleOptions.map((role) => (
                    <option key={`create-role-${role}`} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button className="rounded-md border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black">
                Add User
              </button>
            </div>
          </form>
        </details>

        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Existing users</h3>
          <UsersTable
            users={users as any}
            roles={roleOptions}
            currentUserId={session.user.id}
            onUpdate={updateUserAdminAction}
            onDelete={deleteUserAdminAction}
            onMimic={mimicUserAdminAction}
          />
        </div>
      </div>
    </div>
  );
}
