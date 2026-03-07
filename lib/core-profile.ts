import db from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getUserMetaValue, setUserMetaValue } from "@/lib/user-meta";
import { normalizeProfileImageUrl, PROFILE_IMAGE_META_KEY, resolveProfileImageUrl } from "@/lib/profile-image";

export type CoreProfileRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  displayName: string;
  profileImageUrl: string;
  resolvedImageUrl: string;
  hasNativePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function readCoreProfile(userId: string) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const self = await db.query.users.findFirst({
    where: eq(users.id, normalizedUserId),
    columns: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      username: true,
      gh_username: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!self) return null;

  const [displayNameRaw, profileImageUrlRaw] = await Promise.all([
    getUserMetaValue(self.id, "display_name"),
    getUserMetaValue(self.id, PROFILE_IMAGE_META_KEY),
  ]);
  const displayName = String(displayNameRaw || "").trim() || self.name || "";
  const normalizedProfileImageUrl = normalizeProfileImageUrl(profileImageUrlRaw);
  const profileImageUrl =
    normalizedProfileImageUrl && normalizedProfileImageUrl !== null ? normalizedProfileImageUrl : "";

  return {
    id: self.id,
    name: self.name ?? "",
    email: self.email,
    role: self.role,
    displayName,
    profileImageUrl,
    resolvedImageUrl: resolveProfileImageUrl({
      profileImageUrl,
      providerImageUrl: self.image,
      email: self.email,
      username: self.username ?? self.gh_username,
      name: self.name,
    }),
    hasNativePassword: Boolean(self.passwordHash),
    createdAt: self.createdAt,
    updatedAt: self.updatedAt,
  } satisfies CoreProfileRecord;
}

export async function createCoreProfile(
  userId: string,
  input: {
    name?: string | null;
    email?: string;
    displayName?: string;
    profileImageUrl?: string;
  },
) {
  return updateCoreProfile(userId, input);
}

export async function updateCoreProfile(
  userId: string,
  input: {
    name?: string | null;
    email?: string;
    displayName?: string;
    profileImageUrl?: string;
  },
) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  const nextEmail =
    typeof input.email === "string"
      ? String(input.email || "").trim().toLowerCase()
      : undefined;
  const nextName =
    input.name === undefined
      ? undefined
      : typeof input.name === "string"
        ? input.name
        : null;
  const nextDisplayName =
    input.displayName === undefined
      ? undefined
      : String(input.displayName || "").trim();
  const normalizedProfileImageUrl =
    input.profileImageUrl === undefined
      ? undefined
      : normalizeProfileImageUrl(input.profileImageUrl);

  if (normalizedProfileImageUrl === null) {
    throw new Error("Profile image must be an absolute http(s) URL or a root-relative path");
  }

  const userPatch: Partial<typeof users.$inferInsert> = {};
  if (nextName !== undefined) userPatch.name = nextName;
  if (nextEmail !== undefined) userPatch.email = nextEmail;

  if (Object.keys(userPatch).length > 0) {
    await db
      .update(users)
      .set(userPatch)
      .where(eq(users.id, normalizedUserId));
  }

  const writes: Promise<unknown>[] = [];
  if (nextDisplayName !== undefined) {
    writes.push(setUserMetaValue(normalizedUserId, "display_name", nextDisplayName));
  }
  if (normalizedProfileImageUrl !== undefined) {
    writes.push(setUserMetaValue(normalizedUserId, PROFILE_IMAGE_META_KEY, normalizedProfileImageUrl || ""));
  }
  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return readCoreProfile(normalizedUserId);
}
