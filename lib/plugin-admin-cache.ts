export function getPluginWorkspaceRevalidationPaths(pluginId: string, siteId?: string) {
  const normalizedPluginId = String(pluginId || "").trim();
  const normalizedSiteId = String(siteId || "").trim();
  const paths = new Set<string>();

  if (normalizedPluginId) {
    paths.add(`/plugins/${normalizedPluginId}`);
    paths.add(`/app/plugins/${normalizedPluginId}`);
  }

  if (normalizedSiteId) {
    paths.add(`/app/site/${normalizedSiteId}/settings/plugins`);
  }

  return [...paths];
}
