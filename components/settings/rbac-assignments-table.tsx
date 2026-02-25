"use client";

import { useMemo, useState, useTransition } from "react";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type Props = {
  users: UserRow[];
  roles: string[];
  onUpdate: (formData: FormData) => Promise<void>;
};

export default function RbacAssignmentsTable({ users, roles, onUpdate }: Props) {
  const initialRolesByUser = useMemo(
    () => Object.fromEntries(users.map((user) => [user.id, user.role || "author"])) as Record<string, string>,
    [users],
  );
  const [rolesByUser, setRolesByUser] = useState<Record<string, string>>(initialRolesByUser);
  const [isPending, startTransition] = useTransition();

  async function updateRole(user: UserRow, role: string) {
    const previousRole = rolesByUser[user.id] || user.role || "author";
    setRolesByUser((prev) => ({ ...prev, [user.id]: role }));
    const formData = new FormData();
    formData.set("id", user.id);
    formData.set("name", user.name || "");
    formData.set("email", user.email || "");
    formData.set("role", role);
    try {
      await onUpdate(formData);
    } catch {
      setRolesByUser((prev) => ({ ...prev, [user.id]: previousRole }));
    }
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
      <table className="min-w-full text-sm">
        <thead className="bg-stone-50 dark:bg-stone-900">
          <tr>
            <th className="px-3 py-2 text-left">User</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-stone-200 dark:border-stone-700">
              <td className="px-3 py-2">{user.name || "Unnamed"}</td>
              <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{user.email}</td>
              <td className="px-3 py-2">
                <select
                  value={rolesByUser[user.id] || user.role || "author"}
                  onChange={(event) => {
                    const nextRole = event.target.value;
                    startTransition(() => {
                      void updateRole(user, nextRole);
                    });
                  }}
                  disabled={isPending}
                  className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-60 dark:border-stone-600 dark:bg-black dark:text-white"
                >
                  {roles.map((role) => (
                    <option key={`${user.id}-${role}`} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
