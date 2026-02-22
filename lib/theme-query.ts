import db from "@/lib/db";
import {
  cmsSettings,
  dataDomains,
  domainPostMeta,
  domainPosts,
  sites,
  termRelationships,
  termTaxonomies,
  terms,
} from "@/lib/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY,
  THEME_QUERY_NETWORK_ENABLED_KEY,
} from "@/lib/cms-config";

export type ThemeQuerySource = "content.list";
export type ThemeQueryScope = "site" | "network";
export type ThemeQueryRequest = {
  key: string;
  source: ThemeQuerySource;
  scope?: ThemeQueryScope;
  params?: Record<string, unknown>;
};

const MAX_LIMIT = 24;

function normalizeSlugLike(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "");
}

function toLimit(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function parseSiteIdList(raw: string) {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractFirstImageFromContent(rawContent: unknown): string {
  if (typeof rawContent !== "string" || !rawContent.trim()) return "";
  try {
    const doc = JSON.parse(rawContent);
    const visit = (node: any): string => {
      if (!node || typeof node !== "object") return "";
      if (node.type === "image" && typeof node?.attrs?.src === "string") return node.attrs.src;
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          const image = visit(child);
          if (image) return image;
        }
      }
      return "";
    };
    return visit(doc);
  } catch {
    return "";
  }
}

async function resolveAllowedNetworkSiteIds(currentSiteId: string) {
  const currentSite = await db.query.sites.findFirst({
    where: eq(sites.id, currentSiteId),
    columns: { id: true, userId: true, isPrimary: true },
  });
  if (!currentSite || !currentSite.userId) {
    return [currentSiteId];
  }

  const [enabledRow, allowedIdsRow] = await Promise.all([
    db.query.cmsSettings.findFirst({
      where: eq(cmsSettings.key, THEME_QUERY_NETWORK_ENABLED_KEY),
      columns: { value: true },
    }),
    db.query.cmsSettings.findFirst({
      where: eq(cmsSettings.key, THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY),
      columns: { value: true },
    }),
  ]);

  const networkEnabled = enabledRow?.value === "true";
  if (!networkEnabled) return [currentSiteId];

  const configuredAllowedIds = new Set(parseSiteIdList(allowedIdsRow?.value || ""));
  const isAllowedByGovernance = currentSite.isPrimary || configuredAllowedIds.has(currentSite.id);
  if (!isAllowedByGovernance) return [currentSiteId];

  const ownerSites = await db.query.sites.findMany({
    where: eq(sites.userId, currentSite.userId),
    columns: { id: true },
  });
  return ownerSites.map((row) => row.id);
}

async function runContentListQuery(siteId: string, scope: ThemeQueryScope, params: Record<string, unknown>) {
  const dataDomain = normalizeSlugLike(params.dataDomain);
  if (!dataDomain) return [];

  const taxonomy = normalizeSlugLike(params.taxonomy || "category");
  const withTerm = normalizeSlugLike(params.withTerm);
  const limit = toLimit(params.limit, 10);

  const requestedMetaKeys = Array.isArray(params.metaKeys) ? params.metaKeys : [];
  const metaKeys = requestedMetaKeys
    .map((value) => normalizeSlugLike(value))
    .filter(Boolean)
    .slice(0, 20);

  const siteIds = scope === "network" ? await resolveAllowedNetworkSiteIds(siteId) : [siteId];
  if (!siteIds.length) return [];

  const rows = await db
    .select({
      id: domainPosts.id,
      siteId: domainPosts.siteId,
      title: domainPosts.title,
      description: domainPosts.description,
      content: domainPosts.content,
      slug: domainPosts.slug,
      createdAt: domainPosts.createdAt,
    })
    .from(domainPosts)
    .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
    .where(
      and(
        inArray(domainPosts.siteId, siteIds as string[]),
        eq(domainPosts.published, true),
        eq(dataDomains.key, dataDomain),
      ),
    )
    .orderBy(desc(domainPosts.createdAt))
    .limit(Math.max(limit * 5, limit));

  if (!rows.length) return [];

  const objectIds = rows.map((row) => row.id);
  const termRows = await db
    .select({
      objectId: termRelationships.objectId,
      taxonomy: termTaxonomies.taxonomy,
      slug: terms.slug,
      name: terms.name,
    })
    .from(termRelationships)
    .innerJoin(termTaxonomies, eq(termTaxonomies.id, termRelationships.termTaxonomyId))
    .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
    .where(inArray(termRelationships.objectId, objectIds as string[]));

  const termsByObject = new Map<string, Array<{ taxonomy: string; slug: string | null; name: string | null }>>();
  for (const row of termRows) {
    const list = termsByObject.get(row.objectId) || [];
    list.push({ taxonomy: row.taxonomy, slug: row.slug, name: row.name });
    termsByObject.set(row.objectId, list);
  }

  const metaByObject = new Map<string, Record<string, string>>();
  if (metaKeys.length > 0) {
    const metaRows = await db
      .select({
        domainPostId: domainPostMeta.domainPostId,
        key: domainPostMeta.key,
        value: domainPostMeta.value,
      })
      .from(domainPostMeta)
      .where(and(inArray(domainPostMeta.domainPostId, objectIds as string[]), inArray(domainPostMeta.key, metaKeys)));
    for (const row of metaRows) {
      const bag = metaByObject.get(row.domainPostId) || {};
      bag[row.key] = row.value;
      metaByObject.set(row.domainPostId, bag);
    }
  }

  return rows
    .filter((row) => {
      if (!withTerm) return true;
      const localTerms = termsByObject.get(row.id) || [];
      return localTerms.some(
        (term) => normalizeSlugLike(term.taxonomy) === taxonomy && normalizeSlugLike(term.slug || term.name || "") === withTerm,
      );
    })
    .slice(0, limit)
    .map((row) => {
      const rowTerms = termsByObject.get(row.id) || [];
      const termsByTaxonomy = rowTerms.reduce<Record<string, string[]>>((acc, term) => {
        const key = normalizeSlugLike(term.taxonomy);
        if (!key) return acc;
        const label = (term.name || term.slug || "").trim();
        if (!label) return acc;
        const list = acc[key] || [];
        list.push(label);
        acc[key] = list;
        return acc;
      }, {});
      const meta = metaByObject.get(row.id) || {};
      const thumbnailFromMeta = meta.thumbnail || meta.thumbnail_image || meta.image || meta.cover || "";
      return {
        id: row.id,
        siteId: row.siteId,
        title: row.title || "Untitled",
        description: row.description || "",
        slug: row.slug,
        createdAt: row.createdAt,
        href: meta.link || meta.url || meta.external_url || "",
        thumbnail: thumbnailFromMeta || extractFirstImageFromContent(row.content || ""),
        meta,
        terms: termsByTaxonomy,
      };
    });
}

export async function runThemeQueries(siteId: string, requests: ThemeQueryRequest[]) {
  const out: Record<string, unknown> = {};
  for (const request of requests) {
    const key = normalizeSlugLike(request.key).replace(/[:-]/g, "_");
    if (!key) continue;

    if (request.source === "content.list") {
      out[key] = await runContentListQuery(siteId, request.scope || "site", request.params || {});
      continue;
    }

    out[key] = [];
  }
  return out;
}
