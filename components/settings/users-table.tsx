"use client";

import { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  forcePasswordChange?: boolean;
  authProviders?: string[];
};

type Props = {
  users: UserRow[];
  roles: string[];
  currentUserId: string;
  onUpdate: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  onMimic: (formData: FormData) => Promise<void>;
};

type EditState = {
  id: string;
  name: string;
  email: string;
  role: string;
  forcePasswordChange: boolean;
};

function toEditState(user: UserRow): EditState {
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    role: user.role || "author",
    forcePasswordChange: Boolean(user.forcePasswordChange),
  };
}

export default function UsersTable({ users, roles, currentUserId, onUpdate, onDelete, onMimic }: Props) {
  const [activeUser, setActiveUser] = useState<UserRow | null>(null);
  const [draft, setDraft] = useState<EditState | null>(null);
  const [draftPassword, setDraftPassword] = useState("");
  const editState = useMemo(() => (activeUser ? toEditState(activeUser) : null), [activeUser]);
  const isDirty = Boolean(
    editState &&
      draft &&
      (draft.name !== editState.name ||
        draft.email !== editState.email ||
        draft.role !== editState.role ||
        draft.forcePasswordChange !== editState.forcePasswordChange ||
        draftPassword.length > 0),
  );

  useEffect(() => {
    if (!editState) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveUser(null);
      setDraft(null);
      setDraftPassword("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editState]);

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-stone-200 dark:border-stone-700">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-stone-100 dark:bg-stone-900">
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500 dark:text-stone-300">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Auth Providers</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-3 py-2 dark:text-white">{user.name || "—"}</td>
                <td className="px-3 py-2 dark:text-white">{user.email}</td>
                <td className="px-3 py-2 dark:text-white">{user.role}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                    {user.forcePasswordChange ? "Pending" : "Valid"}
                  </span>
                </td>
                <td className="px-3 py-2 dark:text-white">
                  {(user.authProviders || []).length > 0 ? (user.authProviders || []).join(", ") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {user.id !== currentUserId ? (
                      <form action={onMimic}>
                        <input type="hidden" name="targetUserId" value={user.id} />
                        <button className="rounded-md border border-amber-500 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                          Mimic
                        </button>
                      </form>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        const next = toEditState(user);
                        setActiveUser(user);
                        setDraft(next);
                        setDraftPassword("");
                      }}
                      className="rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-700 dark:border-stone-600 dark:text-stone-200"
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editState ? (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xl rounded-lg border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-700 dark:bg-black">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-cal text-xl dark:text-white">Edit User</h4>
              <button
                type="button"
                onClick={() => {
                  setActiveUser(null);
                  setDraft(null);
                  setDraftPassword("");
                }}
                className="rounded-md border border-stone-300 px-2 py-1 text-xs dark:border-stone-600 dark:text-stone-200"
              >
                Close
              </button>
            </div>
            <form
              action={async (formData) => {
                await onUpdate(formData);
                setActiveUser(null);
                setDraft(null);
                setDraftPassword("");
              }}
              className="space-y-2"
            >
              <input type="hidden" name="id" value={draft?.id || editState.id} />
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Name</label>
                <input
                  name="name"
                  value={draft?.name ?? editState.name}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Email</label>
                <input
                  name="email"
                  value={draft?.email ?? editState.email}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                  type="email"
                  required
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">Role</label>
                <select
                  name="role"
                  value={draft?.role ?? editState.role}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, role: event.target.value } : prev))}
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                >
                  {roles.map((role) => (
                    <option key={`edit-role-${role}`} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <details className="rounded-md border border-stone-200 dark:border-stone-700">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">
                  Reset Password (Optional)
                </summary>
                <div className="space-y-2 border-t border-stone-200 p-3 dark:border-stone-700">
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Set a temporary password only when you need to reset user access.
                  </p>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">
                      Temporary password
                    </label>
                    <input
                      name="password"
                      type="password"
                      value={draftPassword}
                      onChange={(event) => setDraftPassword(event.target.value)}
                      placeholder="Leave blank to keep current"
                      className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
                    />
                  </div>
                  <label className="flex items-center gap-2 pt-1 text-xs text-stone-600 dark:text-stone-300">
                    <input
                      type="checkbox"
                      name="force_password_change"
                      checked={draft?.forcePasswordChange ?? editState.forcePasswordChange}
                      onChange={(event) =>
                        setDraft((prev) => (prev ? { ...prev, forcePasswordChange: event.target.checked } : prev))
                      }
                      className="h-4 w-4"
                    />
                    Force change on next login
                  </label>
                </div>
              </details>
              <div className="flex items-center gap-2 pt-2">
                <button
                  disabled={!isDirty}
                  className={
                    isDirty
                      ? "rounded-md border border-stone-700 bg-stone-900 px-3 py-1 text-sm text-white dark:bg-white dark:text-black"
                      : "cursor-not-allowed rounded-md border border-stone-300 bg-stone-100 px-3 py-1 text-sm text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500"
                  }
                >
                  Save
                </button>
                <button
                  formAction={async (formData) => {
                    const ok = window.confirm("Are you sure you want to delete this user?");
                    if (!ok) return;
                    await onDelete(formData);
                    setActiveUser(null);
                    setDraft(null);
                    setDraftPassword("");
                  }}
                  className="rounded-md border border-red-600 px-3 py-1 text-sm text-red-600"
                >
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
