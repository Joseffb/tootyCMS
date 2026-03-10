export function getDomainPostAdminListPath(siteId: string, domainKey: string) {
  return `/app/site/${encodeURIComponent(siteId)}/domain/${encodeURIComponent(domainKey)}`;
}

export function getDomainPostAdminCreatePath(siteId: string, domainKey: string) {
  return `${getDomainPostAdminListPath(siteId, domainKey)}/create`;
}

export function getDomainPostAdminItemPath(siteId: string, domainKey: string, postId: string) {
  return `${getDomainPostAdminListPath(siteId, domainKey)}/item/${encodeURIComponent(postId)}`;
}

export function getDomainPostAdminItemSettingsPath(siteId: string, domainKey: string, postId: string) {
  return `${getDomainPostAdminItemPath(siteId, domainKey, postId)}/settings`;
}
