import { getPluginRequestedCapabilities, getPluginSuggestedRoleGrants } from "@/lib/plugin-permissions";
import { grantRoleCapabilities, listRbacRoles } from "@/lib/rbac";

type PluginPermissionSource = {
  id?: string;
  permissions?: {
    contentMeta?: {
      requested?: boolean;
      suggestedRoles?: string[];
    };
  } | null;
} | null;

export type PluginInstallPermissionPreview = {
  requestedCapabilities: string[];
  existingRoleGrants: Array<{
    role: string;
    capabilities: string[];
  }>;
  ignoredSuggestedRoles: string[];
};

export async function buildPluginInstallPermissionPreview(
  plugin: PluginPermissionSource,
): Promise<PluginInstallPermissionPreview> {
  const requestedCapabilities = getPluginRequestedCapabilities(plugin);
  const requestedRoleGrants = getPluginSuggestedRoleGrants(plugin);
  const existingRoles = new Set((await listRbacRoles()).map((row) => row.role));

  const existingRoleGrants = Object.entries(requestedRoleGrants)
    .filter(([role]) => existingRoles.has(role))
    .map(([role, capabilities]) => ({
      role,
      capabilities: [...capabilities],
    }))
    .sort((a, b) => a.role.localeCompare(b.role));

  const ignoredSuggestedRoles = Object.keys(requestedRoleGrants)
    .filter((role) => !existingRoles.has(role))
    .sort((a, b) => a.localeCompare(b));

  return {
    requestedCapabilities,
    existingRoleGrants,
    ignoredSuggestedRoles,
  };
}

export async function applyPluginInstallPermissionGrants(plugin: PluginPermissionSource) {
  const preview = await buildPluginInstallPermissionPreview(plugin);
  for (const grant of preview.existingRoleGrants) {
    await grantRoleCapabilities(grant.role, grant.capabilities);
  }
  return preview;
}
