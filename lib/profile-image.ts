export const PROFILE_IMAGE_META_KEY = "profile_image_url";

function isAllowedProfileImageUrl(value: string) {
  if (!value) return false;
  if (value.startsWith("/")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeProfileImageUrl(input: unknown) {
  const value = String(input || "").trim();
  if (!value) return "";
  return isAllowedProfileImageUrl(value) ? value : null;
}

export function buildGeneratedAvatarUrl(seed: unknown) {
  const normalized = String(seed || "").trim() || "user";
  return `https://avatar.vercel.sh/${encodeURIComponent(normalized)}`;
}

export function resolveProfileImageUrl(input: {
  profileImageUrl?: unknown;
  providerImageUrl?: unknown;
  email?: unknown;
  username?: unknown;
  name?: unknown;
}) {
  const profileImageUrl = normalizeProfileImageUrl(input.profileImageUrl);
  if (profileImageUrl) return profileImageUrl;

  const providerImageUrl = normalizeProfileImageUrl(input.providerImageUrl);
  if (providerImageUrl) return providerImageUrl;

  return buildGeneratedAvatarUrl(input.email || input.username || input.name || "user");
}
