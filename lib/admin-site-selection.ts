import { inArray } from "drizzle-orm";

import { getAuthorizedSiteForAnyCapability, getAuthorizedSiteForUser } from "@/lib/authorization";
import db from "@/lib/db";
import type { SiteCapability } from "@/lib/rbac";
import { sites } from "@/lib/schema";
import { listSiteIdsForUser } from "@/lib/site-user-tables";

type SiteSelectionRecord = {
  id: string;
  isPrimary?: boolean | null;
  subdomain?: string | null;
};

export type AdminMode = "single-site" | "multi-site";
export type AdminScope = "network" | "site" | "merged-single-site";

function normalizeSiteId(value: string | null | undefined) {
  return String(value || "").trim();
}

export function resolvePrimarySite<T extends SiteSelectionRecord>(sites: T[]) {
  return sites.find((site) => site.isPrimary || site.subdomain === "main") || sites[0] || null;
}

export function resolveAccessibleSiteId<T extends SiteSelectionRecord>(
  sites: T[],
  requestedSiteId: string | null | undefined,
) {
  const normalizedRequestedSiteId = normalizeSiteId(requestedSiteId);
  const primarySite = resolvePrimarySite(sites);
  const accessibleSiteIdSet = new Set(sites.map((site) => normalizeSiteId(site.id)).filter(Boolean));

  return accessibleSiteIdSet.has(normalizedRequestedSiteId)
    ? normalizedRequestedSiteId
    : normalizeSiteId(primarySite?.id);
}

export function resolveAdminMode(siteCount: number): AdminMode {
  return siteCount === 1 ? "single-site" : "multi-site";
}

export function resolveAdminScope(input: {
  siteCount: number;
  mainSiteId: string | null | undefined;
  effectiveSiteId: string | null | undefined;
}): {
  adminMode: AdminMode;
  activeScope: AdminScope;
  mainSiteId: string | null;
  effectiveSiteId: string | null;
} {
  const mainSiteId = normalizeSiteId(input.mainSiteId) || null;
  const siteCount = Number.isFinite(input.siteCount) ? input.siteCount : 0;
  const adminMode = resolveAdminMode(siteCount);
  const effectiveSiteId =
    adminMode === "single-site"
      ? mainSiteId
      : normalizeSiteId(input.effectiveSiteId) || null;

  return {
    adminMode,
    activeScope:
      adminMode === "single-site"
        ? "merged-single-site"
        : effectiveSiteId
          ? "site"
          : "network",
    mainSiteId,
    effectiveSiteId,
  };
}

async function listAccessibleSitesForUser(userId: string) {
  const accessibleSiteIds = await listSiteIdsForUser(userId);
  if (accessibleSiteIds.length === 0) return [];

  return db.query.sites.findMany({
    where: inArray(sites.id, accessibleSiteIds),
    columns: {
      id: true,
      isPrimary: true,
      subdomain: true,
    },
  });
}

export async function resolvePrimaryAccessibleSiteIdForUser(userId: string) {
  const accessibleSites = await listAccessibleSitesForUser(userId);
  return resolvePrimarySite(accessibleSites)?.id || "";
}

export async function resolveAuthorizedSiteForUser(
  userId: string,
  requestedSiteId: string | null | undefined,
  capability: SiteCapability,
) {
  const normalizedRequestedSiteId = normalizeSiteId(requestedSiteId);
  const directSite = normalizedRequestedSiteId
    ? await getAuthorizedSiteForUser(userId, normalizedRequestedSiteId, capability)
    : null;
  if (directSite) {
    return { site: directSite, effectiveSiteId: directSite.id, usedFallback: false };
  }

  const accessibleSites = await listAccessibleSitesForUser(userId);
  const effectiveSiteId = resolveAccessibleSiteId(accessibleSites, normalizedRequestedSiteId);
  if (!effectiveSiteId) {
    return { site: null, effectiveSiteId: "", usedFallback: false };
  }

  const fallbackSite = await getAuthorizedSiteForUser(userId, effectiveSiteId, capability);
  return {
    site: fallbackSite,
    effectiveSiteId: fallbackSite?.id || "",
    usedFallback: Boolean(fallbackSite && fallbackSite.id !== normalizedRequestedSiteId),
  };
}

export async function resolveAuthorizedSiteForAnyCapability(
  userId: string,
  requestedSiteId: string | null | undefined,
  capabilities: SiteCapability[],
) {
  const normalizedRequestedSiteId = normalizeSiteId(requestedSiteId);
  const directSite = normalizedRequestedSiteId
    ? await getAuthorizedSiteForAnyCapability(userId, normalizedRequestedSiteId, capabilities)
    : null;
  if (directSite) {
    return { site: directSite, effectiveSiteId: directSite.id, usedFallback: false };
  }

  const accessibleSites = await listAccessibleSitesForUser(userId);
  const effectiveSiteId = resolveAccessibleSiteId(accessibleSites, normalizedRequestedSiteId);
  if (!effectiveSiteId) {
    return { site: null, effectiveSiteId: "", usedFallback: false };
  }

  const fallbackSite = await getAuthorizedSiteForAnyCapability(userId, effectiveSiteId, capabilities);
  return {
    site: fallbackSite,
    effectiveSiteId: fallbackSite?.id || "",
    usedFallback: Boolean(fallbackSite && fallbackSite.id !== normalizedRequestedSiteId),
  };
}
