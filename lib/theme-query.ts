import db from "@/lib/db";
import {
  dataDomains,
  domainPostMeta,
  domainPosts,
  sites,
  termRelationships,
  termTaxonomies,
  terms,
} from "@/lib/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { userCan } from "@/lib/authorization";
import type { SiteCapability } from "@/lib/rbac";
import {
  THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY,
  THEME_QUERY_NETWORK_ENABLED_KEY,
} from "@/lib/cms-config";
import { getSettingByKey } from "@/lib/settings-store";

export type ThemeQuerySource = "content.list";
export type ThemeQueryScope = "site" | "network";
export type ThemeQueryRequest = {
  key: string;
  source: ThemeQuerySource;
  scope?: ThemeQueryScope;
  params?: Record<string, unknown>;
  requiresCapability?: SiteCapability;
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

function readQueryParam(params: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (params[key] !== undefined) return params[key];
  }
  const options = params.options;
  if (options && typeof options === "object") {
    const optionsRecord = options as Record<string, unknown>;
    for (const key of keys) {
      if (optionsRecord[key] !== undefined) return optionsRecord[key];
    }
  }
  return undefined;
}

function normalizeSortField(value: unknown) {
  const raw = String(value || "createdAt").trim();
  const normalized = raw.toLowerCase();
  if (normalized === "createdat" || normalized === "created_at" || normalized === "date") return "createdAt";
  if (normalized === "title") return "title";
  if (normalized === "slug") return "slug";
  if (normalized === "id") return "id";
  return raw;
}

function normalizeSortDirection(value: unknown) {
  return String(value || "desc").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function toDateValue(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function toStringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function getFieldValue(entry: Record<string, unknown>, field: string): unknown {
  const normalized = String(field || "").trim();
  if (!normalized) return undefined;
  const parts = normalized.split(".").filter(Boolean);
  if (!parts.length) return undefined;
  let current: unknown = entry;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeToRegex(pattern: string) {
  const escaped = escapeRegex(pattern).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function comparePrimitive(actual: unknown, expected: unknown, operator: string) {
  const op = String(operator || "eq").trim().toLowerCase();
  const actualValue = actual;
  const expectedValue = expected;

  if (op === "is_null") return actualValue === null || actualValue === undefined;
  if (op === "is_not_null") return actualValue !== null && actualValue !== undefined;

  if (op === "in" || op === "nin") {
    const list = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
    const contains = list.some((item) => String(item) === String(actualValue));
    return op === "in" ? contains : !contains;
  }

  if (op === "like" || op === "ilike") {
    const pattern = toStringValue(expectedValue).trim();
    const actualString = toStringValue(actualValue);
    if (!pattern) return false;
    if (pattern.includes("%") || pattern.includes("_")) return likeToRegex(pattern).test(actualString);
    return actualString.toLowerCase().includes(pattern.toLowerCase());
  }

  if (op === "contains") {
    if (Array.isArray(actualValue)) {
      return actualValue.some((item) => String(item) === String(expectedValue));
    }
    return toStringValue(actualValue).toLowerCase().includes(toStringValue(expectedValue).toLowerCase());
  }

  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const actualDate = toDateValue(actualValue);
    const expectedDate = toDateValue(expectedValue);
    if (actualDate !== null && expectedDate !== null) {
      if (op === "gt") return actualDate > expectedDate;
      if (op === "gte") return actualDate >= expectedDate;
      if (op === "lt") return actualDate < expectedDate;
      return actualDate <= expectedDate;
    }
    const actualNumber = Number(actualValue);
    const expectedNumber = Number(expectedValue);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    if (op === "gt") return actualNumber > expectedNumber;
    if (op === "gte") return actualNumber >= expectedNumber;
    if (op === "lt") return actualNumber < expectedNumber;
    return actualNumber <= expectedNumber;
  }

  if (Array.isArray(actualValue) && (op === "eq" || op === "=")) {
    return actualValue.some((item) => String(item) === String(expectedValue));
  }
  if (Array.isArray(actualValue) && (op === "neq" || op === "!=" || op === "<>")) {
    return actualValue.every((item) => String(item) !== String(expectedValue));
  }

  if (op === "neq" || op === "!=" || op === "<>") return String(actualValue) !== String(expectedValue);
  return String(actualValue) === String(expectedValue);
}

type WhereNode = Record<string, unknown> | Array<Record<string, unknown>>;

function evaluateWhereNode(entry: Record<string, unknown>, node: unknown): boolean {
  if (!node) return true;
  if (Array.isArray(node)) {
    return node.every((child) => evaluateWhereNode(entry, child));
  }
  if (typeof node !== "object") return true;
  const rule = node as Record<string, unknown>;
  const clauses = Array.isArray(rule.clauses) ? rule.clauses : null;
  if (clauses && clauses.length > 0) {
    const modifier = String(rule.modifier || "and").trim().toLowerCase() === "or" ? "or" : "and";
    return modifier === "or"
      ? clauses.some((child) => evaluateWhereNode(entry, child))
      : clauses.every((child) => evaluateWhereNode(entry, child));
  }
  const field = String(rule.field || rule.key || "").trim();
  if (!field) return true;
  const operator = String(rule.operator || rule.compare || "eq").trim().toLowerCase();
  const expected = rule.value;
  const actual = getFieldValue(entry, field);
  return comparePrimitive(actual, expected, operator);
}

export function matchesThemeWhereForTest(entry: Record<string, unknown>, where: unknown) {
  return evaluateWhereNode(entry, where as WhereNode);
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

  const [enabledValue, allowedIdsValue] = await Promise.all([
    getSettingByKey(THEME_QUERY_NETWORK_ENABLED_KEY),
    getSettingByKey(THEME_QUERY_NETWORK_ALLOWED_SITE_IDS_KEY),
  ]);

  const networkEnabled = enabledValue === "true";
  if (!networkEnabled) return [currentSiteId];

  const configuredAllowedIds = new Set(parseSiteIdList(allowedIdsValue || ""));
  const isAllowedByGovernance = currentSite.isPrimary || configuredAllowedIds.has(currentSite.id);
  if (!isAllowedByGovernance) return [currentSiteId];

  const ownerSites = await db.query.sites.findMany({
    where: eq(sites.userId, currentSite.userId),
    columns: { id: true },
  });
  return ownerSites.map((row) => row.id);
}

async function runContentListQuery(siteId: string, scope: ThemeQueryScope, params: Record<string, unknown>) {
  const dataDomain = normalizeSlugLike(
    readQueryParam(params, ["dataDomain", "data_domain", "postType", "post_type"]),
  );
  if (!dataDomain) return [];

  const taxonomy = normalizeSlugLike(readQueryParam(params, ["taxonomy"]) || "category");
  const withTerm = normalizeSlugLike(readQueryParam(params, ["withTerm", "with_term"]));
  const limit = toLimit(readQueryParam(params, ["limit", "postsPerPage", "posts_per_page"]), 10);
  const orderBy = normalizeSortField(readQueryParam(params, ["orderBy", "orderby", "order_by"]));
  const order = normalizeSortDirection(readQueryParam(params, ["order"]));
  const where = readQueryParam(params, ["where"]);

  const requestedMetaKeys = Array.isArray(readQueryParam(params, ["metaKeys", "meta_keys"]))
    ? (readQueryParam(params, ["metaKeys", "meta_keys"]) as unknown[])
    : [];
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

  const filtered = rows
    .filter((row) => {
      if (!withTerm) return true;
      const localTerms = termsByObject.get(row.id) || [];
      return localTerms.some(
        (term) => normalizeSlugLike(term.taxonomy) === taxonomy && normalizeSlugLike(term.slug || term.name || "") === withTerm,
      );
    })
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

  const whereFiltered = where ? filtered.filter((entry) => evaluateWhereNode(entry as Record<string, unknown>, where)) : filtered;
  const sorted = [...whereFiltered].sort((left, right) => {
    const leftValue = getFieldValue(left as Record<string, unknown>, orderBy);
    const rightValue = getFieldValue(right as Record<string, unknown>, orderBy);
    const leftDate = toDateValue(leftValue);
    const rightDate = toDateValue(rightValue);
    if (leftDate !== null && rightDate !== null) {
      return order === "asc" ? leftDate - rightDate : rightDate - leftDate;
    }
    const leftText = toStringValue(leftValue).toLowerCase();
    const rightText = toStringValue(rightValue).toLowerCase();
    if (leftText === rightText) return 0;
    return order === "asc" ? (leftText > rightText ? 1 : -1) : (leftText < rightText ? 1 : -1);
  });
  return sorted.slice(0, limit);
}

export async function runThemeQueries(
  siteId: string,
  requests: ThemeQueryRequest[],
  actor: { userId?: string | null } = {},
) {
  const out: Record<string, unknown> = {};
  for (const request of requests) {
    const key = normalizeSlugLike(request.key).replace(/[:-]/g, "_");
    if (!key) continue;
    const requiredCapability = request.requiresCapability;
    if (requiredCapability) {
      const actorUserId = String(actor.userId || "").trim();
      if (!actorUserId) {
        out[key] = [];
        continue;
      }
      const allowed = await userCan(requiredCapability, actorUserId, { siteId });
      if (!allowed) {
        out[key] = [];
        continue;
      }
    }

    if (request.source === "content.list") {
      out[key] = await runContentListQuery(siteId, request.scope || "site", request.params || {});
      continue;
    }

    out[key] = [];
  }
  return out;
}
