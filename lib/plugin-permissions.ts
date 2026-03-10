type PluginPermissionInput = {
  id?: string;
  permissions?: {
    contentMeta?: {
      requested?: boolean;
      suggestedRoles?: string[];
    };
  } | null;
} | null;

export const MANAGE_PLUGIN_CONTENT_META_CAPABILITY = "manage_plugin_content_meta";

function normalizeRoleName(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

export function pluginContentMetaCapability(pluginId: string) {
  const normalized = String(pluginId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return normalized ? `manage_plugin_${normalized}_content_meta` : "";
}

export function isPluginScopedContentMetaCapability(capability: unknown) {
  const normalized = String(capability || "").trim().toLowerCase();
  return /^manage_plugin_[a-z0-9_-]+_content_meta$/.test(normalized);
}

export function normalizePluginSuggestedRoles(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((entry) => normalizeRoleName(entry))
        .filter(Boolean),
    ),
  );
}

export function pluginRequestsContentMetaPermission(plugin: PluginPermissionInput) {
  return Boolean(plugin?.permissions?.contentMeta?.requested);
}

export function getPluginRequestedCapabilities(plugin: PluginPermissionInput) {
  if (!pluginRequestsContentMetaPermission(plugin)) return [];
  const pluginCapability = pluginContentMetaCapability(String(plugin?.id || ""));
  return pluginCapability ? [pluginCapability] : [];
}

export function getPluginSuggestedRoleGrants(plugin: PluginPermissionInput) {
  const capabilities = getPluginRequestedCapabilities(plugin);
  if (!capabilities.length) return {} as Record<string, string[]>;
  const roles = normalizePluginSuggestedRoles(plugin?.permissions?.contentMeta?.suggestedRoles);
  return Object.fromEntries(roles.map((role) => [role, [...capabilities]]));
}
