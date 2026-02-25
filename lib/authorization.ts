// DO NOT implement authorization outside lib/authorization.ts
import db from "@/lib/db";
import { domainPosts, sites, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSiteUserRole } from "@/lib/site-user-tables";
import { SITE_CAPABILITIES, roleHasCapability, type SiteCapability } from "@/lib/rbac";

async function getGlobalRole(userId: string) {
  if (!userId) return null;
  const actor = await db.query?.users?.findFirst?.({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  return actor?.role ?? null;
}

function resolveCapability(action: string): SiteCapability | null {
  const normalized = String(action || "").trim().toLowerCase();
  if (!normalized) return null;
  if ((SITE_CAPABILITIES as readonly string[]).includes(normalized)) {
    return normalized as SiteCapability;
  }
  return null;
}

export async function isSuperAdminUser(userId: string) {
  return canUserManageNetworkCapability(userId, "network.rbac.manage");
}

export async function canUserAccessSiteCapability(
  userId: string,
  siteId: string,
  capability: SiteCapability,
) {
  if (!userId || !siteId) return false;
  const globalRole = await getGlobalRole(userId);
  const hasGlobalSiteScope = await canUserManageNetworkCapability(userId, "network.site.manage");
  if (hasGlobalSiteScope && (await roleHasCapability(globalRole, capability))) return true;
  const siteRole = await getSiteUserRole(siteId, userId);
  if (!siteRole) return false;
  return roleHasCapability(siteRole, capability);
}

export async function getAuthorizedSiteForUser(
  userId: string,
  siteId: string,
  capability: SiteCapability,
) {
  if (!userId || !siteId) return null;
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
  });
  if (!site) return null;
  const allowed = await canUserAccessSiteCapability(userId, site.id, capability);
  return allowed ? site : null;
}

export async function canUserAccessSiteAnyCapability(
  userId: string,
  siteId: string,
  capabilities: SiteCapability[],
) {
  for (const capability of capabilities) {
    if (await canUserAccessSiteCapability(userId, siteId, capability)) return true;
  }
  return false;
}

export async function getAuthorizedSiteForAnyCapability(
  userId: string,
  siteId: string,
  capabilities: SiteCapability[],
) {
  if (!userId || !siteId) return null;
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
  });
  if (!site) return null;
  const allowed = await canUserAccessSiteAnyCapability(userId, site.id, capabilities);
  return allowed ? site : null;
}

export async function canUserManageNetworkCapability(
  userId: string,
  capability: SiteCapability,
) {
  if (!userId) return false;
  const role = await getGlobalRole(userId);
  return roleHasCapability(role, capability);
}

export async function userCan(
  action: string,
  userId: string | number,
  options?: { siteId?: string | null },
) {
  const resolvedAction = resolveCapability(action);
  const normalizedUserId = String(userId || "").trim();
  if (!resolvedAction || !normalizedUserId) return false;
  if (resolvedAction.startsWith("network.")) {
    return canUserManageNetworkCapability(normalizedUserId, resolvedAction);
  }
  const siteId = String(options?.siteId || "").trim();
  if (!siteId) return false;
  return canUserAccessSiteCapability(normalizedUserId, siteId, resolvedAction);
}

export const user_can = userCan;

export function isEmailInAllowedAdminList(email: string | null | undefined, allowedEmailsRaw: string) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  const allowed = String(allowedEmailsRaw || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(normalizedEmail);
}

type DomainPostMutationKind = "edit" | "delete";

function mutationCapabilities(kind: DomainPostMutationKind) {
  if (kind === "delete") {
    return {
      own: "site.content.delete.own" as const,
      any: "site.content.delete.any" as const,
    };
  }
  return {
    own: "site.content.edit.own" as const,
    any: "site.content.edit.any" as const,
  };
}

export async function canUserMutateDomainPost(
  userId: string,
  postId: string,
  kind: DomainPostMutationKind,
) {
  if (!userId || !postId) return { allowed: false, post: null as any };
  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, postId),
    columns: { id: true, siteId: true, userId: true, slug: true, published: true },
  });
  if (!post) return { allowed: false, post: null as any };
  if (!post.siteId) return { allowed: false, post };
  const globalRole = await getGlobalRole(userId);
  const hasGlobalSiteScope = await canUserManageNetworkCapability(userId, "network.site.manage");

  const caps = mutationCapabilities(kind);
  if (hasGlobalSiteScope && (await roleHasCapability(globalRole, caps.any))) {
    return { allowed: true, post };
  }
  const siteRole = await getSiteUserRole(post.siteId, userId);
  if (!siteRole) return { allowed: false, post };
  if (await roleHasCapability(siteRole, caps.any)) return { allowed: true, post };
  const isOwner = post.userId === userId;
  if (isOwner && (await roleHasCapability(siteRole, caps.own))) {
    return { allowed: true, post };
  }
  return { allowed: false, post };
}

export async function canUserCreateDomainContent(userId: string, siteId: string) {
  return canUserAccessSiteCapability(userId, siteId, "site.content.create");
}

export async function canUserReadSiteSettings(userId: string, siteId: string) {
  return canUserAccessSiteCapability(userId, siteId, "site.settings.read");
}
