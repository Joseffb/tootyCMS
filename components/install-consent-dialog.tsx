"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/tailwind/ui/dialog";

type InstallConsentDialogProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  directory: string;
  existingRoleGrants: Array<{
    role: string;
    capabilities: string[];
  }>;
  ignoredSuggestedRoles: string[];
  name: string;
  requestedCapabilities: string[];
};

export default function InstallConsentDialog({
  action,
  cancelHref,
  directory,
  existingRoleGrants,
  ignoredSuggestedRoles,
  name,
  requestedCapabilities,
}: InstallConsentDialogProps) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          router.push(cancelHref);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plugin Permission Review</DialogTitle>
          <DialogDescription>
            {name} is requesting permission-related changes. Review the requested capability access and role grants before installing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Installing this plugin can grant new capabilities to existing roles. Continue only if the requested access matches the plugin’s intended behavior.
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Requested Capability Keys</div>
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
              {requestedCapabilities.length ? (
                <ul className="space-y-1 text-sm text-stone-800">
                  {requestedCapabilities.map((capability) => (
                    <li key={capability}>
                      <code>{capability}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-600">No explicit capability grants requested.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">Existing Roles That Would Gain Access</div>
            <div className="overflow-x-auto rounded-md border border-stone-200 bg-stone-50">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-[0.08em] text-stone-500">
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Capabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {existingRoleGrants.length ? (
                    existingRoleGrants.map((grant) => (
                      <tr key={grant.role} className="border-b border-stone-200 last:border-b-0">
                        <td className="px-3 py-2 font-medium text-stone-900">{grant.role}</td>
                        <td className="px-3 py-2 text-stone-700">
                          {grant.capabilities.map((capability) => (
                            <code key={`${grant.role}-${capability}`} className="mr-2 inline-block">
                              {capability}
                            </code>
                          ))}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-stone-600" colSpan={2}>
                        No existing roles will be updated automatically.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {ignoredSuggestedRoles.length ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
              Suggested roles not present in this CMS instance and therefore ignored:
              {" "}
              {ignoredSuggestedRoles.map((role) => (
                <code key={role} className="mr-2 inline-block">
                  {role}
                </code>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="rounded-md border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100"
            onClick={() => router.push(cancelHref)}
          >
            Cancel
          </button>
          <form action={action}>
            <input type="hidden" name="directory" value={directory} />
            <input type="hidden" name="confirmInstall" value="true" />
            <button className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-stone-800">
              Install Plugin
            </button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
