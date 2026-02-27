type UserIdentityInput = {
  displayName?: string | null;
  username?: string | null;
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

export function resolveAuthenticatedDisplayName(input: UserIdentityInput) {
  const byDisplayName = normalize(input.displayName);
  if (byDisplayName) return byDisplayName;
  const byUsername = normalize(input.username);
  if (byUsername) return byUsername;
  return "";
}

export function sanitizePublicCommentMetadata(metadata: unknown) {
  const source = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = normalize(key).toLowerCase();
    if (!normalizedKey) continue;
    if (
      normalizedKey === "author_email" ||
      normalizedKey === "email" ||
      normalizedKey.endsWith("_email")
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
