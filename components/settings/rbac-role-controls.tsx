"use client";

import { useMemo, useRef } from "react";

type Props = {
  roles: string[];
  selectedRole: string;
  canDeleteSelected: boolean;
  onOpenRole: (formData: FormData) => Promise<void>;
  onDeleteRole: (formData: FormData) => Promise<void>;
};

export default function RbacRoleControls({
  roles,
  selectedRole,
  canDeleteSelected,
  onOpenRole,
  onDeleteRole,
}: Props) {
  const openFormRef = useRef<HTMLFormElement | null>(null);
  const deleteFormRef = useRef<HTMLFormElement | null>(null);
  const roleSet = useMemo(() => new Set(roles.map((role) => role.toLowerCase())), [roles]);

  return (
    <div className="mt-5 flex items-end gap-3">
      <form
        ref={openFormRef}
        action={onOpenRole}
        className="flex flex-1 items-end gap-3"
        onSubmit={(event) => {
          const form = event.currentTarget;
          const roleInput = form.elements.namedItem("role") as HTMLInputElement | null;
          const confirmInput = form.elements.namedItem("confirmCreate") as HTMLInputElement | null;
          const rawRole = String(roleInput?.value || "").trim().toLowerCase();
          if (!rawRole) return;
          const isNewRole = !roleSet.has(rawRole);
          if (!isNewRole) {
            if (confirmInput) confirmInput.value = "";
            return;
          }
          const response = window.prompt(`Create new role "${rawRole}"?\nType "create" to confirm.`, "");
          if (String(response || "").trim().toLowerCase() !== "create") {
            event.preventDefault();
            return;
          }
          if (confirmInput) confirmInput.value = "create";
        }}
      >
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-300">
            Role (typeahead + add)
          </label>
          <input
            list="rbac-role-options"
            name="role"
            placeholder="e.g. seo-manager"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <datalist id="rbac-role-options">
            {roles.map((role) => (
              <option key={`role-option-${role}`} value={role} />
            ))}
          </datalist>
          <input type="hidden" name="confirmCreate" defaultValue="" />
        </div>
        <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
          Open Role
        </button>
      </form>

      {canDeleteSelected ? (
        <form
          ref={deleteFormRef}
          action={onDeleteRole}
          onSubmit={(event) => {
            const response = window.prompt(
              `Delete role "${selectedRole}"?\nType "delete" to confirm.`,
              "",
            );
            if (String(response || "").trim().toLowerCase() !== "delete") {
              event.preventDefault();
              return;
            }
            const confirmInput = event.currentTarget.elements.namedItem("confirmDelete") as HTMLInputElement | null;
            if (confirmInput) confirmInput.value = "delete";
          }}
        >
          <input type="hidden" name="role" value={selectedRole} />
          <input type="hidden" name="confirmDelete" defaultValue="" />
          <button className="rounded-md border border-red-700 bg-red-700 px-3 py-2 text-sm text-white hover:bg-white hover:text-red-700">
            Delete Role
          </button>
        </form>
      ) : null}
    </div>
  );
}
