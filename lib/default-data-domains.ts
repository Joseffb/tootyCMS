import { siteDomainTypeMetaTableTemplate, siteDomainTypeTableTemplate } from "@/lib/site-domain-type-tables";
import { ensureSiteDomainTypeTables } from "@/lib/site-domain-type-tables";
import {
  ensureSiteDataDomainTable,
  findSiteDataDomainByKey,
  upsertSiteDataDomain,
} from "@/lib/site-data-domain-registry";
import db from "@/lib/db";
import { sites } from "@/lib/schema";

export const DEFAULT_CORE_DOMAIN_KEYS = ["post", "page"] as const;
export type DefaultCoreDomainKey = (typeof DEFAULT_CORE_DOMAIN_KEYS)[number];

type DomainRow = { id: number; key: string };

async function ensureOneCoreDomain(siteId: string, key: DefaultCoreDomainKey): Promise<DomainRow | null> {
  await ensureSiteDataDomainTable(siteId);
  const existing = await findSiteDataDomainByKey(siteId, key);
  const contentTable = siteDomainTypeTableTemplate(key);
  const metaTable = siteDomainTypeMetaTableTemplate(key);
  if (existing) {
    if (existing.contentTable === contentTable && existing.metaTable === metaTable) {
      return { id: existing.id, key: existing.key };
    }
    const updated = await upsertSiteDataDomain(siteId, {
      key,
      label: key === "post" ? "Post" : "Page",
      contentTable,
      metaTable,
      description: key === "post" ? "Default core post type" : "Default core page type",
      settings: { ...(existing.settings || {}), builtin: true },
      isActive: true,
    });
    return { id: updated.id, key: updated.key };
  }

  const created = await upsertSiteDataDomain(siteId, {
    key,
    label: key === "post" ? "Post" : "Page",
    contentTable,
    metaTable,
    description: key === "post" ? "Default core post type" : "Default core page type",
    settings: { builtin: true },
    isActive: true,
  });
  if (!created?.id) return null;
  return { id: created.id, key: created.key };
}

async function resolveTargetSiteIds(siteId?: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (normalizedSiteId) return [normalizedSiteId];
  const rows = await db
    .select({ id: sites.id })
    .from(sites);
  return rows.map((row) => String(row.id || "").trim()).filter(Boolean);
}

export async function ensureDefaultCoreDataDomains(siteId?: string) {
  const targetSiteIds = await resolveTargetSiteIds(siteId);
  const out = new Map<DefaultCoreDomainKey, number>();
  for (const currentSiteId of targetSiteIds) {
    for (const key of DEFAULT_CORE_DOMAIN_KEYS) {
      const row = await ensureOneCoreDomain(currentSiteId, key);
      // Core post/page domains must become physically queryable as soon as
      // they are registered so public routes and network dashboards do not
      // race a later first-read table creation under shared load.
      await ensureSiteDomainTypeTables(currentSiteId, key);
      if (!siteId && row?.id && !out.has(key)) {
        out.set(key, row.id);
      }
      if (siteId && row?.id) {
        out.set(key, row.id);
      }
    }
  }
  return out;
}

export async function ensureDefaultCoreDataDomainsForSite(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return new Map<DefaultCoreDomainKey, number>();
  return ensureDefaultCoreDataDomains(normalizedSiteId);
}

export async function getCoreDomainByKeyForSite(siteId: string, key: DefaultCoreDomainKey) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return null;
  await ensureDefaultCoreDataDomainsForSite(normalizedSiteId);
  const row = await findSiteDataDomainByKey(normalizedSiteId, key);
  if (!row) return null;
  return { id: row.id, key: row.key };
}
