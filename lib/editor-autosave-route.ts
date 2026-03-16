export function getDomainPostEditorAutosavePath(postId: string) {
  return `/api/editor/domain-posts/${encodeURIComponent(String(postId || "").trim())}/autosave`;
}

export function resolveDomainPostEditorAutosavePath(
  postId: string,
  explicitPath?: string | null,
) {
  const normalizedExplicitPath = String(explicitPath || "").trim();
  if (normalizedExplicitPath) {
    return normalizedExplicitPath;
  }

  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) {
    return null;
  }

  return getDomainPostEditorAutosavePath(normalizedPostId);
}
