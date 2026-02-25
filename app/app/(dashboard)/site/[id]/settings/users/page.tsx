import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { users } from "@/lib/schema";
import { listSiteUsers } from "@/lib/site-user-tables";
import { getAuthorizedSiteForUser } from "@/lib/authorization";
import { inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SiteUsersSettingsPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const siteId = decodeURIComponent(id);
  const site = await getAuthorizedSiteForUser(session.user.id, siteId, "site.users.manage");
  if (!site) notFound();

  const siteUsers = await listSiteUsers(siteId);
  const userIds = Array.from(new Set(siteUsers.map((entry) => entry.user_id))).filter(Boolean);
  const globalUsers = userIds.length
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          authProvider: true,
          createdAt: true,
        },
      })
    : [];
  const globalById = new Map(globalUsers.map((entry) => [entry.id, entry]));
  const rows = siteUsers
    .map((entry) => {
      const account = globalById.get(entry.user_id);
      if (!account) return null;
      return {
        id: account.id,
        name: account.name || "Unnamed User",
        email: account.email,
        authProvider: account.authProvider || "native",
        role: entry.role || "author",
        isActive: entry.is_active !== false,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    email: string;
    authProvider: string;
    role: string;
    isActive: boolean;
  }>;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
      <h2 className="font-cal text-xl dark:text-white">Site Users</h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Users listed here belong to this site. Role and permission are site-specific.
      </p>

      <div className="mt-6 overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900 dark:text-stone-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Auth</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-200 dark:border-stone-700">
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3">{row.email}</td>
                  <td className="px-4 py-3">{row.authProvider}</td>
                  <td className="px-4 py-3">{row.role}</td>
                  <td className="px-4 py-3">{row.isActive ? "Active" : "Inactive"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-stone-500 dark:text-stone-400" colSpan={5}>
                  No users assigned to this site.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
