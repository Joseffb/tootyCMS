"use server";

import { getSession } from "@/lib/auth";
import {
  addDomainToVercel,
  removeDomainFromVercelProject,
  validDomainRegex,
} from "@/lib/domains";
import { getBlurDataURL } from "@/lib/utils";
import { pickRandomTootyImage } from "@/lib/tooty-images";
import {
  getReadingSettings,
  getScheduleSettings,
  getSiteBooleanSetting,
  getSiteTextSetting,
  getSiteWritingSettings,
  getWritingSettings,
  MAIN_HEADER_ENABLED_KEY,
  MAIN_HEADER_SHOW_NETWORK_SITES_KEY,
  isRandomDefaultImagesEnabled,
  SEO_INDEXING_ENABLED_KEY,
  SEO_META_DESCRIPTION_KEY,
  SEO_META_TITLE_KEY,
  SOCIAL_META_DESCRIPTION_KEY,
  SOCIAL_META_IMAGE_KEY,
  SOCIAL_META_TITLE_KEY,
  SCHEDULES_ENABLED_KEY,
  SCHEDULES_PING_SITEMAP_KEY,
  setSiteBooleanSetting,
  setSiteTextSetting,
  setBooleanSetting,
  setRandomDefaultImagesEnabled,
  setSiteUrlSetting,
  setTextSetting,
  WRITING_CATEGORY_BASE_KEY,
  WRITING_EDITOR_MODE_KEY,
  WRITING_LIST_PATTERN_KEY,
  WRITING_NO_DOMAIN_DATA_DOMAIN_KEY,
  WRITING_NO_DOMAIN_PREFIX_KEY,
  WRITING_PERMALINK_MODE_KEY,
  WRITING_PERMALINK_STYLE_KEY,
  WRITING_SINGLE_PATTERN_KEY,
  WRITING_TAG_BASE_KEY,
} from "@/lib/cms-config";
import { put } from "@vercel/blob";
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { revalidatePath, revalidateTag } from "next/cache";
import { withPostAuth, withSiteAuth } from "./auth";
import db from "./db";
import { SelectPost, SelectSite, cmsSettings, posts, sites, users } from "./schema";
import { categories, dataDomains, domainPostMeta, domainPosts, postCategories, postMeta, postTags, siteDataDomains, tags, termRelationships, termTaxonomies, termTaxonomyDomains, terms } from "./schema";
import { singularizeLabel } from "./data-domain-labels";
import { USER_ROLES, type UserRole, isAdministrator } from "./rbac";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  listScheduleEntries,
  updateScheduleEntry,
  type ScheduleEntry,
  type SchedulerOwnerType,
} from "./scheduler";
export const getAllCategories = async () => {
  try {
    const response = await db
      .select({
        id: termTaxonomies.id,
        name: terms.name,
      })
      .from(termTaxonomies)
      .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
      .where(eq(termTaxonomies.taxonomy, "category"))
      .orderBy(asc(terms.name));
    return response;
  } catch {
    return db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
  }
};
export const createCategoryByName = async (name: string, parentId?: number | null) => {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Category name is required" };
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  try {
    const existing = await db
      .select({
        id: termTaxonomies.id,
        name: terms.name,
      })
      .from(termTaxonomies)
      .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
      .where(and(eq(termTaxonomies.taxonomy, "category"), eq(terms.slug, slug)))
      .limit(1);
    if (existing[0]) return existing[0];

    const [createdTerm] = await db
      .insert(terms)
      .values({ name: trimmed, slug: slug || `term-${nanoid().toLowerCase()}` })
      .returning();

    const [createdTaxonomy] = await db
      .insert(termTaxonomies)
      .values({
        termId: createdTerm.id,
        taxonomy: "category",
        parentId: parentId ?? null,
      })
      .returning();

    return { id: createdTaxonomy.id, name: createdTerm.name };
  } catch {
    const existingLegacy = await db.select().from(categories).where(eq(categories.name, trimmed)).limit(1);
    if (existingLegacy[0]) return existingLegacy[0];
    const [created] = await db.insert(categories).values({ name: trimmed }).returning();
    return created;
  }
};
export const getAllTags = async () => {
  try {
    return db
      .select({
        id: termTaxonomies.id,
        name: terms.name,
      })
      .from(termTaxonomies)
      .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
      .where(eq(termTaxonomies.taxonomy, "tag"))
      .orderBy(asc(terms.name));
  } catch {
    return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name));
  }
};
export const createTagByName = async (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Tag name is required" };
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  try {
    const existing = await db
      .select({
        id: termTaxonomies.id,
        name: terms.name,
      })
      .from(termTaxonomies)
      .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
      .where(and(eq(termTaxonomies.taxonomy, "tag"), eq(terms.slug, slug)))
      .limit(1);
    if (existing[0]) return existing[0];

    const [createdTerm] = await db
      .insert(terms)
      .values({ name: trimmed, slug: slug || `term-${nanoid().toLowerCase()}` })
      .returning();

    const [createdTaxonomy] = await db
      .insert(termTaxonomies)
      .values({
        termId: createdTerm.id,
        taxonomy: "tag",
      })
      .returning();

    return { id: createdTaxonomy.id, name: createdTerm.name };
  } catch {
    const existingLegacy = await db.select().from(tags).where(eq(tags.name, trimmed)).limit(1);
    if (existingLegacy[0]) return existingLegacy[0];
    const [created] = await db.insert(tags).values({ name: trimmed }).returning();
    return created;
  }
};
export const getAllMetaKeys = async () => {
  try {
    const rows = await db.select({ key: postMeta.key }).from(postMeta).orderBy(asc(postMeta.key));
    const unique = Array.from(new Set(rows.map((row) => row.key))).filter(Boolean);
    return unique;
  } catch {
    return [];
  }
};
const toDomainKey = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `domain_${nanoid().toLowerCase()}`;

async function ensureDefaultPostType() {
  const [existing] = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(eq(dataDomains.key, "post"))
    .limit(1);
  if (existing) return;

  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

  await db
    .insert(dataDomains)
    .values({
      key: "post",
      label: "Post",
      contentTable: `${normalizedPrefix}posts`,
      metaTable: `${normalizedPrefix}post_meta`,
      description: "Default core post type",
      settings: { builtin: true },
    })
    .onConflictDoNothing();
}

export const getAllDataDomains = async (siteId?: string) => {
  await ensureDefaultPostType();
  const rows = await db.select().from(dataDomains).orderBy(asc(dataDomains.label));
  let usageRows: Array<{ dataDomainId: number; usageCount: number }> = [];
  try {
    usageRows = await db
      .select({
        dataDomainId: domainPosts.dataDomainId,
        usageCount: sql<number>`count(*)::int`,
      })
      .from(domainPosts)
      .groupBy(domainPosts.dataDomainId);
  } catch {
    usageRows = [];
  }
  let corePostUsageCount = 0;
  try {
    const [coreUsage] = await db
      .select({ usageCount: sql<number>`count(*)::int` })
      .from(posts);
    corePostUsageCount = coreUsage?.usageCount ?? 0;
  } catch {
    corePostUsageCount = 0;
  }
  const usageMap = new Map(usageRows.map((row) => [row.dataDomainId, row.usageCount]));
  if (!siteId) {
    return rows.map((row) => ({
      ...row,
      usageCount: row.key === "post" ? corePostUsageCount : usageMap.get(row.id) ?? 0,
    }));
  }

  let assignments: Array<{ dataDomainId: number; isActive: boolean }> = [];
  try {
    assignments = await db
      .select({
        dataDomainId: siteDataDomains.dataDomainId,
        isActive: siteDataDomains.isActive,
      })
      .from(siteDataDomains)
      .where(eq(siteDataDomains.siteId, siteId));
  } catch {
    assignments = [];
  }

  const assignmentMap = new Map(assignments.map((row) => [row.dataDomainId, row.isActive]));
  return rows.map((row) => ({
      ...row,
      assigned: row.key === "post" ? true : assignmentMap.has(row.id),
      isActive: row.key === "post" ? true : assignmentMap.get(row.id) ?? false,
      usageCount: row.key === "post" ? corePostUsageCount : usageMap.get(row.id) ?? 0,
  }));
};

export const getSiteDataDomainByKey = async (siteId: string, domainKey: string) => {
  await ensureDefaultPostType();
  const [row] = await db
    .select({
      id: dataDomains.id,
      key: dataDomains.key,
      label: dataDomains.label,
      isActive: siteDataDomains.isActive,
    })
    .from(dataDomains)
    .leftJoin(
      siteDataDomains,
      and(eq(siteDataDomains.dataDomainId, dataDomains.id), eq(siteDataDomains.siteId, siteId)),
    )
    .where(eq(dataDomains.key, domainKey))
    .limit(1);

  if (!row) return null;
  if (row.key === "post") return { ...row, isActive: true };
  // Allow any domain assigned to the site, even if currently inactive.
  if (row.isActive === null || row.isActive === undefined) return null;
  return row;
};

type DataDomainFieldSpec = {
  key: string;
  type: "text" | "integer" | "boolean" | "timestamp" | "jsonb";
  required?: boolean;
  default?: string | number | boolean | null;
};

const toSqlIdentifier = (input: string) => input.replace(/[^a-zA-Z0-9_]/g, "_");

const extraFieldToSql = (field: DataDomainFieldSpec) => {
  const columnKey = toSqlIdentifier(field.key.trim().toLowerCase());
  if (!columnKey) return null;
  const sqlType =
    field.type === "integer"
      ? "INTEGER"
      : field.type === "boolean"
        ? "BOOLEAN"
        : field.type === "timestamp"
          ? "TIMESTAMP"
          : field.type === "jsonb"
            ? "JSONB"
            : "TEXT";

  let defaultSql = "";
  if (field.default !== undefined) {
    if (field.default === null) defaultSql = " DEFAULT NULL";
    else if (typeof field.default === "number") defaultSql = ` DEFAULT ${field.default}`;
    else if (typeof field.default === "boolean") defaultSql = ` DEFAULT ${field.default ? "TRUE" : "FALSE"}`;
    else if (field.type === "jsonb") defaultSql = ` DEFAULT '${String(field.default).replace(/'/g, "''")}'::jsonb`;
    else defaultSql = ` DEFAULT '${String(field.default).replace(/'/g, "''")}'`;
  }

  const requiredSql = field.required ? " NOT NULL" : "";
  return `"${columnKey}" ${sqlType}${requiredSql}${defaultSql}`;
};

export const createDataDomain = async (input: {
  label: string;
  fields?: DataDomainFieldSpec[];
  siteId?: string;
  activateForSite?: boolean;
}) => {
  const trimmed = input.label.trim();
  if (!trimmed) return { error: "Data Domain label is required" };
  const canonicalLabel = singularizeLabel(trimmed);
  const existingByLabel = await db.select().from(dataDomains).where(eq(dataDomains.label, canonicalLabel)).limit(1);
  if (existingByLabel[0]) return existingByLabel[0];

  const key = toDomainKey(canonicalLabel);
  const existingByKey = await db.select().from(dataDomains).where(eq(dataDomains.key, key)).limit(1);
  if (existingByKey[0]) return existingByKey[0];

  const safeKey = key.replace(/[^a-z0-9-]/g, "").replace(/^-+/, "");
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  const contentTable = `${normalizedPrefix}domain_${safeKey}`;
  const metaTable = `${contentTable}_meta`;
  const extraFields = Array.isArray(input.fields) ? input.fields : [];
  if (!safeKey) return { error: "Invalid Data Domain key" };

  const extraColumnsSql = extraFields
    .map(extraFieldToSql)
    .filter((column): column is string => Boolean(column))
    .join(",\n        ");

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "${contentTable}" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT,
        "description" TEXT,
        "content" TEXT,
        "layout" TEXT,
        "slug" TEXT NOT NULL,
        "image" TEXT DEFAULT '',
        "imageBlurhash" TEXT,
        "published" BOOLEAN NOT NULL DEFAULT FALSE,
        "siteId" TEXT,
        "userId" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
        ${extraColumnsSql ? `,\n        ${extraColumnsSql}` : ""}
      )
    `));
    await tx.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${contentTable}_slug_site_idx" ON "${contentTable}" ("slug", "siteId")`));
    await tx.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "${metaTable}" (
        "id" SERIAL PRIMARY KEY,
        "itemId" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await tx.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${metaTable}_item_key_idx" ON "${metaTable}" ("itemId", "key")`));
  });

  const [created] = await db.insert(dataDomains).values({
    key,
    label: canonicalLabel,
    contentTable,
    metaTable,
    description: "",
    settings: {
      fields: extraFields,
    },
  }).returning();

  if (input.siteId) {
    await db
      .insert(siteDataDomains)
      .values({
        siteId: input.siteId,
        dataDomainId: created.id,
        isActive: input.activateForSite ?? true,
      })
      .onConflictDoUpdate({
        target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
        set: { isActive: input.activateForSite ?? true },
      });
  }

  return created;
};

export const createDataDomainByLabel = async (label: string) => createDataDomain({ label });

export const updateDataDomain = async (input: {
  id: number;
  label: string;
  description?: string;
}) => {
  const trimmed = input.label.trim();
  if (!trimmed) return { error: "Data Domain label is required" };
  const canonicalLabel = singularizeLabel(trimmed);
  const existingByLabel = await db
    .select({ id: dataDomains.id })
    .from(dataDomains)
    .where(and(eq(dataDomains.label, canonicalLabel), sql`${dataDomains.id} <> ${input.id}`))
    .limit(1);
  if (existingByLabel[0]) {
    return { error: "A Post Type with this label already exists" };
  }

  const [updated] = await db
    .update(dataDomains)
    .set({
      label: canonicalLabel,
      description: input.description ?? "",
    })
    .where(eq(dataDomains.id, input.id))
    .returning();

  return updated;
};

const sanitizeDbIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_");

export const deleteDataDomain = async (id: number) => {
  const [domain] = await db.select().from(dataDomains).where(eq(dataDomains.id, id)).limit(1);
  if (!domain) return { error: "Data Domain not found" };

  await db.transaction(async (tx) => {
    const domainPostIds = await tx
      .select({ id: domainPosts.id })
      .from(domainPosts)
      .where(eq(domainPosts.dataDomainId, id));
    if (domainPostIds.length > 0) {
      await tx
        .delete(domainPostMeta)
        .where(inArray(domainPostMeta.domainPostId, domainPostIds.map((row) => row.id)));
    }
    await tx.delete(domainPosts).where(eq(domainPosts.dataDomainId, id));
    await tx.delete(siteDataDomains).where(eq(siteDataDomains.dataDomainId, id));
    await tx.delete(termTaxonomyDomains).where(eq(termTaxonomyDomains.dataDomainId, id));
    await tx.delete(dataDomains).where(eq(dataDomains.id, id));

    const safeContentTable = sanitizeDbIdentifier(domain.contentTable);
    const safeMetaTable = sanitizeDbIdentifier(domain.metaTable);
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS "${safeMetaTable}"`));
    await tx.execute(sql.raw(`DROP TABLE IF EXISTS "${safeContentTable}"`));
  });

  return { ok: true };
};

export const setDataDomainActivation = async (input: {
  siteId: string;
  dataDomainId: number;
  isActive: boolean;
}) => {
  const session = await getSession();
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }
  const actor = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });
  if (!actor || !isAdministrator(actor.role)) {
    return { error: "Admin role required" };
  }

  try {
    await db
      .insert(siteDataDomains)
      .values({
        siteId: input.siteId,
        dataDomainId: input.dataDomainId,
        isActive: input.isActive,
      })
      .onConflictDoUpdate({
        target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
        set: { isActive: input.isActive },
      });
  } catch (error: any) {
    return { error: error?.message ?? "Failed to update activation state" };
  }

  return { ok: true };
};

export const registerCustomTaxonomyForDataDomain = async (input: {
  dataDomainId: number;
  taxonomy: string;
  label: string;
  description?: string;
}) => {
  const taxonomy = input.taxonomy.trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "");
  const label = input.label.trim();
  if (!taxonomy || !label) {
    return { error: "taxonomy and label are required" };
  }

  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  try {
    const [existingTerm] = await db.select().from(terms).where(eq(terms.slug, slug)).limit(1);
    const term =
      existingTerm ??
      (
        await db
          .insert(terms)
          .values({
            name: label,
            slug: slug || `term-${nanoid().toLowerCase()}`,
          })
          .returning()
      )[0];

    const [taxonomyRow] = await db
      .insert(termTaxonomies)
      .values({
        termId: term.id,
        taxonomy,
        description: input.description ?? "",
      })
      .onConflictDoNothing()
      .returning();

    const taxonomyId =
      taxonomyRow?.id ??
      (
        await db
          .select({ id: termTaxonomies.id })
          .from(termTaxonomies)
          .where(and(eq(termTaxonomies.termId, term.id), eq(termTaxonomies.taxonomy, taxonomy)))
          .limit(1)
      )[0]?.id;

    if (!taxonomyId) {
      return { error: "Could not resolve taxonomy id" };
    }

    await db.insert(termTaxonomyDomains).values({
      dataDomainId: input.dataDomainId,
      termTaxonomyId: taxonomyId,
    }).onConflictDoNothing();

    return { ok: true, taxonomyId };
  } catch (error: any) {
    return { error: error?.message ?? "Failed to register taxonomy" };
  }
};

const normalizeTaxonomyKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 48);

const normalizeOptionalParentId = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
};

const validateParentAssignment = async (input: {
  taxonomy: string;
  termTaxonomyId: number;
  parentId: number | null;
}) => {
  const { taxonomy, termTaxonomyId, parentId } = input;
  if (parentId === null) return { ok: true as const };
  if (parentId === termTaxonomyId) return { error: "A term cannot be its own parent." };

  const taxonomyRows = await db
    .select({
      id: termTaxonomies.id,
      parentId: termTaxonomies.parentId,
    })
    .from(termTaxonomies)
    .where(eq(termTaxonomies.taxonomy, taxonomy));

  const byId = new Map(taxonomyRows.map((row) => [row.id, row]));
  if (!byId.has(parentId)) {
    return { error: "Parent term does not exist in this taxonomy." };
  }

  const seen = new Set<number>();
  let cursor: number | null = parentId;
  while (cursor !== null) {
    if (cursor === termTaxonomyId) {
      return { error: "Parent assignment creates a taxonomy cycle." };
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }

  return { ok: true as const };
};

async function ensureDefaultCategoryTaxonomy() {
  const existingCategory = await db
    .select({ id: termTaxonomies.id })
    .from(termTaxonomies)
    .where(eq(termTaxonomies.taxonomy, "category"))
    .limit(1);
  if (existingCategory[0]) return;

  const [existingGeneral] = await db
    .select({ id: terms.id })
    .from(terms)
    .where(eq(terms.slug, "general"))
    .limit(1);

  const termId =
    existingGeneral?.id ??
    (
      await db
        .insert(terms)
        .values({
          name: "General",
          slug: "general",
        })
        .returning({ id: terms.id })
    )[0]?.id;

  if (!termId) return;

  await db
    .insert(termTaxonomies)
    .values({
      termId,
      taxonomy: "category",
      description: "Default category taxonomy",
      count: 0,
    })
    .onConflictDoNothing();
}

export const getTaxonomyOverview = async () => {
  await ensureDefaultCategoryTaxonomy();

  const rows = await db
    .select({
      taxonomy: termTaxonomies.taxonomy,
      termCount: sql<number>`count(*)::int`,
      usageCount: sql<number>`coalesce(sum(${termTaxonomies.count}), 0)::int`,
    })
    .from(termTaxonomies)
    .groupBy(termTaxonomies.taxonomy)
    .orderBy(termTaxonomies.taxonomy);

  const merged = new Map<string, { taxonomy: string; termCount: number; usageCount: number }>();
  for (const row of rows) merged.set(row.taxonomy, row);
  if (!merged.has("category")) {
    merged.set("category", { taxonomy: "category", termCount: 0, usageCount: 0 });
  }

  const labelRows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(like(cmsSettings.key, "taxonomy_label_%"));
  const labelMap = new Map(
    labelRows.map((row) => [row.key.replace(/^taxonomy_label_/, ""), row.value]),
  );

  return Array.from(merged.values())
    .sort((a, b) => a.taxonomy.localeCompare(b.taxonomy))
    .map((row) => ({
    ...row,
    label:
      labelMap.get(row.taxonomy) ??
      (row.taxonomy === "category"
        ? "Category"
        : row.taxonomy
            .split(/[_:-]/g)
            .filter(Boolean)
            .map((piece) => piece[0].toUpperCase() + piece.slice(1))
            .join(" ")),
    }));
};

export const setTaxonomyLabel = async (input: { taxonomy: string; label: string }) => {
  const taxonomy = normalizeTaxonomyKey(input.taxonomy);
  const label = input.label.trim();
  if (!taxonomy || !label) return { error: "taxonomy and label are required" };
  await db
    .insert(cmsSettings)
    .values({
      key: `taxonomy_label_${taxonomy}`,
      value: label,
    })
    .onConflictDoUpdate({
      target: cmsSettings.key,
      set: { value: label },
    });
  return { ok: true };
};

export const getTaxonomyTerms = async (taxonomy: string) => {
  const key = normalizeTaxonomyKey(taxonomy);
  if (!key) return [];
  return db
    .select({
      id: termTaxonomies.id,
      termId: terms.id,
      taxonomy: termTaxonomies.taxonomy,
      name: terms.name,
      slug: terms.slug,
      parentId: termTaxonomies.parentId,
      usageCount: termTaxonomies.count,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(eq(termTaxonomies.taxonomy, key))
    .orderBy(asc(terms.name));
};

export const getTaxonomyTermsPreview = async (taxonomy: string, limit = 20) => {
  const key = normalizeTaxonomyKey(taxonomy);
  if (!key) return [];
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 20;
  return db
    .select({
      id: termTaxonomies.id,
      termId: terms.id,
      taxonomy: termTaxonomies.taxonomy,
      name: terms.name,
      slug: terms.slug,
      parentId: termTaxonomies.parentId,
      usageCount: termTaxonomies.count,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(eq(termTaxonomies.taxonomy, key))
    .orderBy(asc(terms.name))
    .limit(safeLimit);
};

export const createTaxonomy = async (input: { taxonomy: string; label?: string; description?: string }) => {
  const key = normalizeTaxonomyKey(input.taxonomy);
  if (!key) return { error: "Taxonomy key is required" };
  const label = (input.label?.trim() || key).slice(0, 120);
  return createTaxonomyTerm({
    taxonomy: key,
    label,
    description: input.description,
  });
};

export const renameTaxonomy = async (input: { current: string; next: string }) => {
  const current = normalizeTaxonomyKey(input.current);
  const next = normalizeTaxonomyKey(input.next);
  if (!current || !next) return { error: "Current and next taxonomy keys are required" };
  await db.update(termTaxonomies).set({ taxonomy: next }).where(eq(termTaxonomies.taxonomy, current));
  return { ok: true };
};

export const deleteTaxonomy = async (taxonomy: string) => {
  const key = normalizeTaxonomyKey(taxonomy);
  if (!key) return { error: "Taxonomy key is required" };

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: termTaxonomies.id, termId: termTaxonomies.termId })
      .from(termTaxonomies)
      .where(eq(termTaxonomies.taxonomy, key));
    if (rows.length === 0) return;
    const taxonomyIds = rows.map((row) => row.id);
    await tx.delete(termRelationships).where(inArray(termRelationships.termTaxonomyId, taxonomyIds));
    await tx.delete(termTaxonomyDomains).where(inArray(termTaxonomyDomains.termTaxonomyId, taxonomyIds));
    await tx.delete(termTaxonomies).where(inArray(termTaxonomies.id, taxonomyIds));

    const termIds = rows.map((row) => row.termId);
    const remaining = await tx
      .select({ termId: termTaxonomies.termId })
      .from(termTaxonomies)
      .where(inArray(termTaxonomies.termId, termIds));
    const remainingSet = new Set(remaining.map((row) => row.termId));
    const orphaned = termIds.filter((termId) => !remainingSet.has(termId));
    if (orphaned.length > 0) {
      await tx.delete(terms).where(inArray(terms.id, orphaned));
    }
  });

  return { ok: true };
};

export const createTaxonomyTerm = async (input: {
  taxonomy: string;
  label: string;
  description?: string;
  parentId?: number | null;
}) => {
  const taxonomy = normalizeTaxonomyKey(input.taxonomy);
  const label = input.label.trim();
  const parentId = normalizeOptionalParentId(input.parentId);
  if (!taxonomy || !label) {
    return { error: "taxonomy and label are required" };
  }

  if (taxonomy === "category") return createCategoryByName(label, parentId);
  if (taxonomy === "tag") return createTagByName(label);

  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const [existingTerm] = await db.select().from(terms).where(eq(terms.slug, slug)).limit(1);
  const term =
    existingTerm ??
    (
      await db
        .insert(terms)
        .values({
          name: label,
          slug: slug || `term-${nanoid().toLowerCase()}`,
        })
        .returning()
    )[0];

  if (parentId !== null) {
    const [parent] = await db
      .select({ id: termTaxonomies.id })
      .from(termTaxonomies)
      .where(and(eq(termTaxonomies.id, parentId), eq(termTaxonomies.taxonomy, taxonomy)))
      .limit(1);
    if (!parent) {
      return { error: "Parent term does not exist in this taxonomy." };
    }
  }

  const [created] = await db
    .insert(termTaxonomies)
    .values({
      termId: term.id,
      taxonomy,
      description: input.description ?? "",
      parentId,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;
  const [existing] = await db
    .select()
    .from(termTaxonomies)
    .where(and(eq(termTaxonomies.termId, term.id), eq(termTaxonomies.taxonomy, taxonomy)))
    .limit(1);
  return existing ?? { error: "Failed to create term taxonomy" };
};

export const updateTaxonomyTerm = async (input: {
  termTaxonomyId: number;
  label?: string;
  slug?: string;
  parentId?: number | null;
}) => {
  const hasLabel = typeof input.label === "string";
  const hasSlug = typeof input.slug === "string";
  const hasParent = Object.prototype.hasOwnProperty.call(input, "parentId");
  if (!hasLabel && !hasSlug && !hasParent) {
    return { error: "No updates supplied" };
  }

  const [current] = await db
    .select({ termId: termTaxonomies.termId, taxonomy: termTaxonomies.taxonomy })
    .from(termTaxonomies)
    .where(eq(termTaxonomies.id, input.termTaxonomyId))
    .limit(1);
  if (!current) return { error: "Term taxonomy not found" };

  if (hasLabel || hasSlug) {
    const [currentTerm] = await db
      .select({ name: terms.name, slug: terms.slug })
      .from(terms)
      .where(eq(terms.id, current.termId))
      .limit(1);
    if (!currentTerm) return { error: "Term not found" };

    const nextLabel = hasLabel ? input.label!.trim() : currentTerm.name;
    if (!nextLabel) return { error: "Label is required" };
    const nextSlugSource = hasSlug ? input.slug!.trim() : currentTerm.slug;
    const nextSlug = (nextSlugSource || nextLabel)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    await db
      .update(terms)
      .set({ name: nextLabel, slug: nextSlug || `term-${nanoid().toLowerCase()}` })
      .where(eq(terms.id, current.termId));
  }

  if (hasParent) {
    const nextParentId = normalizeOptionalParentId(input.parentId);
    const validation = await validateParentAssignment({
      taxonomy: current.taxonomy,
      termTaxonomyId: input.termTaxonomyId,
      parentId: nextParentId,
    });
    if ("error" in validation) return validation;

    await db
      .update(termTaxonomies)
      .set({ parentId: nextParentId })
      .where(eq(termTaxonomies.id, input.termTaxonomyId));
  }

  return { ok: true };
};

export const deleteTaxonomyTerm = async (termTaxonomyId: number) => {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: termTaxonomies.id, termId: termTaxonomies.termId, taxonomy: termTaxonomies.taxonomy })
      .from(termTaxonomies)
      .where(eq(termTaxonomies.id, termTaxonomyId))
      .limit(1);
    if (!current) return;

    await tx
      .update(termTaxonomies)
      .set({ parentId: null })
      .where(and(eq(termTaxonomies.taxonomy, current.taxonomy), eq(termTaxonomies.parentId, termTaxonomyId)));

    await tx.delete(termRelationships).where(eq(termRelationships.termTaxonomyId, termTaxonomyId));
    await tx.delete(termTaxonomyDomains).where(eq(termTaxonomyDomains.termTaxonomyId, termTaxonomyId));
    await tx.delete(termTaxonomies).where(eq(termTaxonomies.id, termTaxonomyId));

    const [stillUsed] = await tx
      .select({ id: termTaxonomies.id })
      .from(termTaxonomies)
      .where(eq(termTaxonomies.termId, current.termId))
      .limit(1);
    if (!stillUsed) {
      await tx.delete(terms).where(eq(terms.id, current.termId));
    }
  });
  return { ok: true };
};
const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
); // 7-character random string

const MAX_SEO_SLUG_LENGTH = 80;

function toSeoSlug(input: string) {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SEO_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return normalized || `post-${nanoid().toLowerCase()}`;
}

export const createSite = async (formData: FormData) => {
  const session = await getSession();
  if (!session?.user.id) {
    return {
      error: "Not authenticated",
    };
  }
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const subdomain = formData.get("subdomain") as string;
  const normalizedSubdomain = subdomain.trim().toLowerCase();
  if (normalizedSubdomain === "main") {
    return {
      error: "Subdomain 'main' is reserved for the Main Site.",
    };
  }
  const useRandomDefaultImages = await isRandomDefaultImagesEnabled();

  try {
    const [response] = await db
      .insert(sites)
      .values({
        name,
        description,
        subdomain: normalizedSubdomain,
        ...(useRandomDefaultImages ? { image: pickRandomTootyImage() } : {}),
        userId: session.user.id,
      })
      .returning();

    revalidateTag(
      `${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-metadata`,
      "max",
    );
    return response;
  } catch (error: any) {
    if (error.code === "P2002") {
      return {
        error: `This subdomain is already taken`,
      };
    } else {
      return {
        error: error.message,
      };
    }
  }
};

export const updateSite = withSiteAuth(
  async (formData: FormData, site: SelectSite, key: string) => {
    try {
      let response;

      const maybeFile = formData.get(key);
      const maybeUrl = formData.get(`${key}Url`) as string | null;
      const maybeFinal = formData.get(`${key}FinalName`) as string | null;

      // 🔎 Safely pick final URL in priority order: FinalName > Url > undefined
      const finalUrl =
        (typeof maybeFinal === "string" && maybeFinal.length > 0)
          ? maybeFinal
          : (typeof maybeUrl === "string" && maybeUrl.length > 0)
            ? maybeUrl
            : undefined;

      // --- Handle custom domain logic ---
      if (key === "customDomain") {
        const value = maybeFile as string;

        if (value.includes("vercel.pub")) {
          return { error: "Cannot use vercel.pub subdomain as your custom domain" };
        }

        if (validDomainRegex.test(value)) {
          response = await db.update(sites)
            .set({ customDomain: value })
            .where(eq(sites.id, site.id))
            .returning()
            .then((res) => res[0]);

          await addDomainToVercel(value);
        } else if (value === "") {
          response = await db.update(sites)
            .set({ customDomain: null })
            .where(eq(sites.id, site.id))
            .returning()
            .then((res) => res[0]);
        }

        if (site.customDomain && site.customDomain !== value) {
          await removeDomainFromVercelProject(site.customDomain);
        }

        // --- Handle images/logo/heroImage logic ---
      } else if (key === "image" || key === "logo" || key === "heroImage") {
        if (maybeFile instanceof File && maybeFile.size > 0) {
          // ⬆️ Vercel Blob file upload path
          const filename = `${nanoid()}.${maybeFile.type.split("/")[1]}`;
          const { url } = await put(filename, maybeFile, { access: "public" });
          const blurhash = key === "image" ? await getBlurDataURL(url) : null;

          response = await db.update(sites)
            .set({
              [key]: url,
              ...(blurhash && { imageBlurhash: blurhash }),
            })
            .where(eq(sites.id, site.id))
            .returning()
            .then((res) => res[0]);

        } else if (finalUrl) {
          // ⬇️ Local upload path (finalUrl)
          const blurhash = key === "image"
            ? await getBlurDataURL(`${process.cwd()}/public${finalUrl}`)
            : null;

          response = await db.update(sites)
            .set({
              [key]: finalUrl,
              ...(blurhash && { imageBlurhash: blurhash }),
            })
            .where(eq(sites.id, site.id))
            .returning()
            .then((res) => res[0]);

        } else {
          return { error: `No valid file or URL provided for ${key}` };
        }

        // --- Handle generic string updates ---
      } else {
        const value = maybeFile as string;
        if (key === "subdomain") {
          const nextSubdomain = value.trim().toLowerCase();
          if (site.isPrimary && nextSubdomain !== "main") {
            return { error: "The Main Site subdomain must remain 'main'." };
          }
          if (!site.isPrimary && nextSubdomain === "main") {
            return { error: "Subdomain 'main' is reserved for the Main Site." };
          }
        }

        response = await db.update(sites)
          .set({ [key]: value })
          .where(eq(sites.id, site.id))
          .returning()
          .then((res) => res[0]);
      }

      // ✅ Revalidate cache
      revalidateTag(`${site.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-metadata`, "max");
      site.customDomain && revalidateTag(`${site.customDomain}-metadata`, "max");

      return response;
    } catch (error: any) {
      return {
        error: error.code === "P2002"
          ? `This ${key} is already taken`
          : error.message,
      };
    }
  }
);

export const deleteSite = withSiteAuth(
  async (_: FormData, site: SelectSite) => {
    try {
      if (site.isPrimary || site.subdomain === "main") {
        return {
          error: "The Main Site cannot be deleted.",
        };
      }

      const ownedSiteCount = await db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.userId, site.userId!));
      if (ownedSiteCount.length <= 1) {
        return {
          error: "You must keep at least one site. Create another site before deleting this one.",
        };
      }

      const [response] = await db
        .delete(sites)
        .where(eq(sites.id, site.id))
        .returning();

      revalidateTag(
        `${site.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-metadata`,
        "max",
      );
      response.customDomain && revalidateTag(`${site.customDomain}-metadata`, "max");
      return response;
    } catch (error: any) {
      return {
        error: error.message,
      };
    }
  },
);

export const getSiteFromPostId = async (postId: string) => {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: {
      siteId: true,
    },
  });

  return post?.siteId;
};

export const getSiteFromDomainPostId = async (postId: string) => {
  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, postId),
    columns: {
      siteId: true,
    },
  });

  return post?.siteId;
};

export const createDomainPost = withSiteAuth(
  async (_: FormData, site: SelectSite, domainKey: string | null) => {
    const session = await getSession();
    if (!session?.user.id) {
      return {
        error: "Not authenticated",
      };
    }
    if (!domainKey) {
      return {
        error: "Data domain key is required",
      };
    }

    const domain = await getSiteDataDomainByKey(site.id, domainKey);
    if (!domain || domain.key === "post") {
      return {
        error: "Data domain not found for site",
      };
    }

    const useRandomDefaultImages = await isRandomDefaultImagesEnabled();
    const [response] = await db
      .insert(domainPosts)
      .values({
        siteId: site.id,
        userId: session.user.id,
        dataDomainId: domain.id,
        slug: toSeoSlug(`${domain.key}-${nanoid()}`),
        ...(useRandomDefaultImages ? { image: pickRandomTootyImage() } : {}),
      })
      .returning();

    revalidateTag(
      `${site.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-posts`,
      "max",
    );
    site.customDomain && revalidateTag(`${site.customDomain}-posts`, "max");

    return response;
  },
);

export const updateDomainPost = async (
  data: {
    id: string;
    title?: string | null;
    description?: string | null;
    content?: string | null;
    layout?: string | null;
    categoryIds?: number[];
    tagIds?: number[];
    taxonomyIds?: number[];
    metaEntries?: Array<{ key: string; value: string }>;
  },
) => {
  const session = await getSession();
  if (!session?.user.id) {
    return { error: "Not authenticated" };
  }

  const existing = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, data.id),
    columns: { userId: true, siteId: true, slug: true, dataDomainId: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { error: "Post not found or not authorized" };
  }

  try {
    const postRecord = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(domainPosts)
        .set({
          title: data.title,
          description: data.description,
          content: data.content,
          layout: data.layout ?? null,
        })
        .where(eq(domainPosts.id, data.id))
        .returning();

      await tx.delete(termRelationships).where(eq(termRelationships.objectId, data.id));
      const taxonomyIds = Array.from(
        new Set(
          Array.isArray(data.taxonomyIds)
            ? data.taxonomyIds
            : [...(data.categoryIds ?? []), ...(data.tagIds ?? [])],
        ),
      );
      if (taxonomyIds.length > 0) {
        await tx.insert(termRelationships).values(
          taxonomyIds.map((termTaxonomyId) => ({
            objectId: data.id,
            termTaxonomyId,
          })),
        );
      }

      await tx.delete(domainPostMeta).where(eq(domainPostMeta.domainPostId, data.id));
      if (Array.isArray(data.metaEntries) && data.metaEntries.length > 0) {
        const normalizedMeta = data.metaEntries
          .map((entry) => ({
            key: entry.key.trim(),
            value: entry.value.trim(),
          }))
          .filter((entry) => entry.key.length > 0);

        if (normalizedMeta.length > 0) {
          await tx.insert(domainPostMeta).values(
            normalizedMeta.map((entry) => ({
              domainPostId: data.id,
              key: entry.key,
              value: entry.value,
            })),
          );
        }
      }

      return updated;
    });

    const taxonomyRows = await db
      .select({
        id: termTaxonomies.id,
        taxonomy: termTaxonomies.taxonomy,
      })
      .from(termRelationships)
      .innerJoin(termTaxonomies, eq(termRelationships.termTaxonomyId, termTaxonomies.id))
      .where(eq(termRelationships.objectId, data.id));

    const cats = taxonomyRows
      .filter((row) => row.taxonomy === "category")
      .map((row) => ({ categoryId: row.id }));
    const tagRows = taxonomyRows
      .filter((row) => row.taxonomy === "tag")
      .map((row) => ({ tagId: row.id }));

    const metaRows = await db
      .select({
        key: domainPostMeta.key,
        value: domainPostMeta.value,
      })
      .from(domainPostMeta)
      .where(eq(domainPostMeta.domainPostId, data.id));

    const { siteId, slug } = existing;
    if (siteId) {
      const siteRow = await db.query.sites.findFirst({
        where: eq(sites.id, siteId),
        columns: { subdomain: true, customDomain: true },
      });
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
      if (siteRow?.subdomain) {
        const domain = `${siteRow.subdomain}.${rootDomain}`;
        revalidateTag(`${domain}-posts`, "max");
        revalidateTag(`${domain}-${slug}`, "max");
      }
      if (siteRow?.customDomain) {
        revalidateTag(`${siteRow.customDomain}-posts`, "max");
        revalidateTag(`${siteRow.customDomain}-${slug}`, "max");
      }
    }

    return {
      ...postRecord,
      categories: cats,
      tags: tagRows,
      meta: metaRows,
    };
  } catch (error: any) {
    console.error("updateDomainPost error:", error);
    return { error: error.message };
  }
};

export const updateDomainPostMetadata = async (
  formData: FormData,
  postId: string,
  key: string,
) => {
  const session = await getSession();
  if (!session?.user.id) {
    return { error: "Not authenticated" };
  }

  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, postId),
    with: {
      site: true,
    },
  });
  if (!post || post.userId !== session.user.id) {
    return { error: "Post not found" };
  }

  try {
    let response;
    const maybeFile = formData.get("image") as File | null;
    const maybeUrl = formData.get("imageUrl") as string | null;
    const maybeFinal = formData.get("imageFinalName") as string | null;
    const finalUrl =
      maybeFinal?.length ? maybeFinal :
        maybeUrl?.length ? maybeUrl :
          undefined;

    if (key === "image") {
      if (maybeFile && maybeFile.size > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
        const filename = `${nanoid()}.${maybeFile.type.split("/")[1]}`;
        const { url } = await put(filename, maybeFile, { access: "public" });
        const blurhash = await getBlurDataURL(url);

        response = await db
          .update(domainPosts)
          .set({
            image: url,
            imageBlurhash: blurhash,
          })
          .where(eq(domainPosts.id, post.id))
          .returning()
          .then((res) => res[0]);
      } else if (finalUrl) {
        const blurhash = await getBlurDataURL(`${process.cwd()}/public${finalUrl}`);

        response = await db
          .update(domainPosts)
          .set({
            image: finalUrl,
            imageBlurhash: blurhash,
          })
          .where(eq(domainPosts.id, post.id))
          .returning()
          .then((res) => res[0]);
      } else {
        return { error: "No valid image upload or URL provided" };
      }
    } else {
      const value = formData.get(key) as string;
      const nextValue =
        key === "published"
          ? value === "true"
          : key === "slug"
            ? toSeoSlug(value)
            : value;

      response = await db
        .update(domainPosts)
        .set({
          [key]: nextValue,
        })
        .where(eq(domainPosts.id, post.id))
        .returning()
        .then((res) => res[0]);
    }

    const siteRow = post.siteId
      ? await db.query.sites.findFirst({
          where: eq(sites.id, post.siteId),
          columns: { subdomain: true, customDomain: true },
        })
      : null;
    const domain = siteRow?.customDomain;
    const subdomain = siteRow?.subdomain;
    const currentSlug = post.slug;
    const updatedSlug = response?.slug ?? currentSlug;

    revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-posts`, "max");
    revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-${currentSlug}`, "max");
    if (updatedSlug !== currentSlug) {
      revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-${updatedSlug}`, "max");
    }
    if (domain) {
      revalidateTag(`${domain}-posts`, "max");
      revalidateTag(`${domain}-${currentSlug}`, "max");
      if (updatedSlug !== currentSlug) {
        revalidateTag(`${domain}-${updatedSlug}`, "max");
      }
    }

    return response;
  } catch (error: any) {
    return {
      error: error.code === "P2002" ? "This slug is already in use" : error.message,
    };
  }
};

export const deleteDomainPost = async (postId: string) => {
  const session = await getSession();
  if (!session?.user.id) {
    return { error: "Not authenticated" };
  }

  const post = await db.query.domainPosts.findFirst({
    where: eq(domainPosts.id, postId),
    columns: { id: true, userId: true, siteId: true },
  });
  if (!post || post.userId !== session.user.id) {
    return { error: "Post not found" };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(domainPostMeta).where(eq(domainPostMeta.domainPostId, post.id));
      await tx.delete(termRelationships).where(eq(termRelationships.objectId, post.id));
      await tx.delete(domainPosts).where(eq(domainPosts.id, post.id));
    });
    return { siteId: post.siteId };
  } catch (error: any) {
    return { error: error.message };
  }
};

export const createPost = withSiteAuth(
  async (_: FormData, site: SelectSite) => {
    const session = await getSession();
    if (!session?.user.id) {
      return {
        error: "Not authenticated",
      };
    }

    const useRandomDefaultImages = await isRandomDefaultImagesEnabled();
    const [response] = await db
      .insert(posts)
      .values({
        siteId: site.id,
        userId: session.user.id,
        slug: toSeoSlug(`post ${nanoid()}`),
        ...(useRandomDefaultImages ? { image: pickRandomTootyImage() } : {}),
      })
      .returning();

    revalidateTag(
      `${site.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-posts`,
      "max",
    );
    site.customDomain && revalidateTag(`${site.customDomain}-posts`, "max");

    return response;
  },
);

// creating a separate function for this because we're not using FormData
// lib/actions.ts

export const updatePost = async (
  data: Partial<SelectPost> & {
    id: string;                    // always required
    layout?: string | null;
    categoryIds?: number[];
    tagIds?: number[];
    taxonomyIds?: number[];
    metaEntries?: Array<{ key: string; value: string }>;
  }
) => {
  const session = await getSession();
  if (!session?.user.id) {
    return { error: "Not authenticated" };
  }

  // 1. Verify ownership + grab siteId & slug
  const existing = await db.query.posts.findFirst({
    where: eq(posts.id, data.id),
    columns: { userId: true, siteId: true, slug: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { error: "Post not found or not authorized" };
  }

  try {
    // 2. Transaction: update post + sync categories
    const postRecord = await db.transaction(async (tx) => {
      // a) update posts table
      const [updated] = await tx
        .update(posts)
        .set({
          title: data.title,
          description: data.description,
          slug: typeof data.slug === "string" ? toSeoSlug(data.slug) : undefined,
          content: data.content,
          layout: data.layout ?? null,
        })
        .where(eq(posts.id, data.id))
        .returning();

      // b) taxonomy relationships (WordPress-style terms/taxonomies/relationships)
      try {
        await tx.delete(termRelationships).where(eq(termRelationships.objectId, data.id));
        const taxonomyIds = Array.from(
          new Set(
            Array.isArray(data.taxonomyIds)
              ? data.taxonomyIds
              : [...(data.categoryIds ?? []), ...(data.tagIds ?? [])],
          ),
        );
        if (taxonomyIds.length > 0) {
          await tx.insert(termRelationships).values(
            taxonomyIds.map((termTaxonomyId) => ({
              objectId: data.id,
              termTaxonomyId,
            })),
          );
        }
      } catch {
        // Legacy fallback while taxonomy tables are not migrated yet.
        await tx.delete(postCategories).where(eq(postCategories.postId, data.id));
        if (Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
          await tx.insert(postCategories).values(
            data.categoryIds.map((categoryId) => ({
              postId: data.id,
              categoryId,
            })),
          );
        }
        await tx.delete(postTags).where(eq(postTags.postId, data.id));
        if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
          await tx.insert(postTags).values(
            data.tagIds.map((tagId) => ({
              postId: data.id,
              tagId,
            })),
          );
        }
      }

      // c) clear old post meta and set current values
      try {
        await tx.delete(postMeta).where(eq(postMeta.postId, data.id));
        if (Array.isArray(data.metaEntries) && data.metaEntries.length > 0) {
          const normalizedMeta = data.metaEntries
            .map((entry) => ({
              key: entry.key.trim(),
              value: entry.value.trim(),
            }))
            .filter((entry) => entry.key.length > 0);

          if (normalizedMeta.length > 0) {
            await tx.insert(postMeta).values(
              normalizedMeta.map((entry) => ({
                postId: data.id,
                key: entry.key,
                value: entry.value,
              })),
            );
          }
        }
      } catch {
        // Legacy fallback when post_meta table is not migrated yet.
      }

      return updated;
    });

    // 3. Fetch fresh categories
    let cats: Array<{ categoryId: number }> = [];
    let tagRows: Array<{ tagId: number }> = [];
    try {
      const taxonomyRows = await db
        .select({
          id: termTaxonomies.id,
          taxonomy: termTaxonomies.taxonomy,
        })
        .from(termRelationships)
        .innerJoin(termTaxonomies, eq(termRelationships.termTaxonomyId, termTaxonomies.id))
        .where(eq(termRelationships.objectId, data.id));
      cats = taxonomyRows
        .filter((row) => row.taxonomy === "category")
        .map((row) => ({ categoryId: row.id }));
      tagRows = taxonomyRows
        .filter((row) => row.taxonomy === "tag")
        .map((row) => ({ tagId: row.id }));
    } catch {
      const legacyCats = await db.query.postCategories.findMany({
        where: eq(postCategories.postId, data.id),
        columns: { categoryId: true },
      });
      const legacyTags = await db.query.postTags.findMany({
        where: eq(postTags.postId, data.id),
        columns: { tagId: true },
      });
      cats = legacyCats.map((c) => ({ categoryId: c.categoryId }));
      tagRows = legacyTags.map((t) => ({ tagId: t.tagId }));
    }
    let metaRows: Array<{ key: string; value: string }> = [];
    try {
      metaRows = await db.query.postMeta.findMany({
        where: eq(postMeta.postId, data.id),
        columns: { key: true, value: true },
      });
    } catch {
      metaRows = [];
    }

    // 4. Revalidate cache tags (domain-based, matching fetchers.ts)
    const { siteId, slug } = existing;
    const updatedSlug = postRecord?.slug ?? slug;
    if (siteId) {
      const siteRow = await db.query.sites.findFirst({
        where: eq(sites.id, siteId),
        columns: { subdomain: true, customDomain: true },
      });
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
      if (siteRow?.subdomain) {
        const domain = `${siteRow.subdomain}.${rootDomain}`;
        revalidateTag(`${domain}-posts`, "max");
        revalidateTag(`${domain}-${slug}`, "max");
        if (updatedSlug !== slug) {
          revalidateTag(`${domain}-${updatedSlug}`, "max");
        }
      }
      if (siteRow?.customDomain) {
        revalidateTag(`${siteRow.customDomain}-posts`, "max");
        revalidateTag(`${siteRow.customDomain}-${slug}`, "max");
        if (updatedSlug !== slug) {
          revalidateTag(`${siteRow.customDomain}-${updatedSlug}`, "max");
        }
      }
    }

    // 5. Return the updated post *with* its categories
    return {
      ...postRecord,
      categories: cats,
      tags: tagRows,
      meta: metaRows,
    };
  } catch (error: any) {
    console.error("🧨 updatePost error:", error);
    return { error: error.message };
  }
};

export const updatePostMetadata = withPostAuth(
  async (
    formData: FormData,
    post: SelectPost & {
      site: SelectSite;
    },
    key: string
  ) => {
    try {
      let response;

      const maybeFile = formData.get("image") as File | null;
      const maybeUrl = formData.get("imageUrl") as string | null;
      const maybeFinal = formData.get("imageFinalName") as string | null;

      const finalUrl =
        maybeFinal?.length ? maybeFinal :
          maybeUrl?.length ? maybeUrl :
            undefined;

      // 🖼️ Handle image upload for "image" key
      if (key === "image") {
        // 1. Direct file upload (Vercel Blob)
        if (maybeFile && maybeFile.size > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
          const filename = `${nanoid()}.${maybeFile.type.split("/")[1]}`;
          const { url } = await put(filename, maybeFile, { access: "public" });
          const blurhash = await getBlurDataURL(url);

          response = await db
            .update(posts)
            .set({
              image: url,
              imageBlurhash: blurhash,
            })
            .where(eq(posts.id, post.id))
            .returning()
            .then((res) => res[0]);

          // 2. Local file or provided URL
        } else if (finalUrl) {
          const blurhash = await getBlurDataURL(`${process.cwd()}/public${finalUrl}`);

          response = await db
            .update(posts)
            .set({
              image: finalUrl,
              imageBlurhash: blurhash,
            })
            .where(eq(posts.id, post.id))
            .returning()
            .then((res) => res[0]);

        } else {
          return { error: "No valid image upload or URL provided" };
        }

      } else {
        // 📝 Any other metadata (e.g., title, description, published)
        const value = formData.get(key) as string;
        const nextValue =
          key === "published"
            ? value === "true"
            : key === "slug"
              ? toSeoSlug(value)
              : value;

        response = await db
          .update(posts)
          .set({
            [key]: nextValue,
          })
          .where(eq(posts.id, post.id))
          .returning()
          .then((res) => res[0]);
      }

      // ♻️ Revalidate all relevant cache tags
      const domain = post.site?.customDomain;
      const subdomain = post.site?.subdomain;
      const currentSlug = post.slug;
      const updatedSlug = response?.slug ?? currentSlug;

      revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-posts`, "max");
      revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-${currentSlug}`, "max");
      if (updatedSlug !== currentSlug) {
        revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-${updatedSlug}`, "max");
      }
      if (domain) {
        revalidateTag(`${domain}-posts`, "max");
        revalidateTag(`${domain}-${currentSlug}`, "max");
        if (updatedSlug !== currentSlug) {
          revalidateTag(`${domain}-${updatedSlug}`, "max");
        }
      }

      return response;
    } catch (error: any) {
      return {
        error: error.code === "P2002"
          ? `This slug is already in use`
          : error.message,
      };
    }
  }
);
export const deletePost = withPostAuth(
  async (formData: FormData, post: SelectPost) => {
    const confirmation = String(formData.get("confirm") ?? "").trim().toLowerCase();
    if (confirmation !== "delete") {
      return {
        error: "Type delete to confirm post deletion.",
      };
    }

    try {
      const [response] = await db
        .delete(posts)
        .where(eq(posts.id, post.id))
        .returning({
          siteId: posts.siteId,
        });

      return response;
    } catch (error: any) {
      return {
        error: error.message,
      };
    }
  },
);

export const editUser = async (
  formData: FormData,
  _id: unknown,
  key: string,
) => {
  const session = await getSession();
  if (!session?.user.id) {
    return {
      error: "Not authenticated",
    };
  }
  const value = formData.get(key) as string;

  try {
    const [response] = await db
      .update(users)
      .set({
        [key]: value,
      })
      .where(eq(users.id, session.user.id))
      .returning();

    return response;
  } catch (error: any) {
    if (error.code === "P2002") {
      return {
        error: `This ${key} is already in use`,
      };
    } else {
      return {
        error: error.message,
      };
    }
  }
};

const OAUTH_PROVIDER_IDS = ["github", "google", "facebook", "apple"] as const;
type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

function parseAdminEmails() {
  const raw = process.env.CMS_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdminSession() {
  const session = await getSession();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("Not authenticated");
  }

  let self = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });

  // Self-heal local sessions after fresh installs/db wipes.
  if (!self) {
    const anyUser = await db.query.users.findFirst({
      columns: { id: true },
    });
    const roleForNewUser: UserRole = anyUser ? "author" : "administrator";
    await db
      .insert(users)
      .values({
        id: session.user.id,
        email: session.user.email.toLowerCase(),
        name: session.user.name ?? null,
        image: session.user.image ?? null,
        role: roleForNewUser,
      })
      .onConflictDoNothing();

    self = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { role: true },
    });
  }

  // If there is no admin yet, promote current user.
  const anyAdmin = await db.query.users.findFirst({
    where: eq(users.role, "administrator"),
    columns: { id: true },
  });
  if (!anyAdmin && self) {
    await db
      .update(users)
      .set({ role: "administrator" })
      .where(eq(users.id, session.user.id));
    self = { role: "administrator" as UserRole };
  }
  if (isAdministrator(self?.role)) {
    return session;
  }

  const admins = parseAdminEmails();
  if (admins.length > 0 && !admins.includes(session.user.email.toLowerCase())) {
    throw new Error("Not authorized");
  }

  return session;
}

function normalizeOptionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function revalidateSettingsPath(path: string) {
  revalidatePath(path);
  const appPath = path.startsWith("/app") ? path : `/app${path}`;
  revalidatePath(appPath);
}

async function requireOwnedSite(siteIdRaw: string) {
  const session = await getSession();
  if (!session?.user?.id) return { error: "Not authenticated" as const };
  const siteId = decodeURIComponent(siteIdRaw);
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: {
      id: true,
      userId: true,
      subdomain: true,
      customDomain: true,
      isPrimary: true,
      name: true,
      description: true,
      heroSubtitle: true,
      image: true,
      logo: true,
    },
  });
  if (!site || site.userId !== session.user.id) {
    return { error: "Not authorized" as const };
  }
  return { site };
}

export const listUsersAdmin = async () => {
  await requireAdminSession();

  return db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      username: true,
      gh_username: true,
      email: true,
      image: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: (users, { asc }) => [asc(users.createdAt)],
  });
};

export const createUserAdmin = async (formData: FormData) => {
  await requireAdminSession();

  const emailRaw = formData.get("email");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!email || !validateEmail(email)) {
    return { error: "Valid email is required" };
  }

  const name = normalizeOptionalString(formData.get("name"));
  const username = normalizeOptionalString(formData.get("username"));
  const ghUsername = normalizeOptionalString(formData.get("gh_username"));
  const image = normalizeOptionalString(formData.get("image"));
  const roleRaw = normalizeOptionalString(formData.get("role"));
  const role: UserRole = USER_ROLES.includes((roleRaw as UserRole) || "author")
    ? ((roleRaw as UserRole) ?? "author")
    : "author";

  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name,
        username,
        gh_username: ghUsername,
        image,
        role,
      })
      .returning({
        id: users.id,
      });

    revalidateSettingsPath("/settings/users");
    return { ok: true, id: created.id };
  } catch (error: any) {
    if (error?.code === "23505") {
      return { error: "User with that email already exists" };
    }
    return { error: error?.message || "Failed to create user" };
  }
};

export const updateUserAdmin = async (formData: FormData) => {
  await requireAdminSession();

  const id = normalizeOptionalString(formData.get("id"));
  if (!id) return { error: "Missing user id" };

  const emailRaw = formData.get("email");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!email || !validateEmail(email)) {
    return { error: "Valid email is required" };
  }

  const name = normalizeOptionalString(formData.get("name"));
  const username = normalizeOptionalString(formData.get("username"));
  const ghUsername = normalizeOptionalString(formData.get("gh_username"));
  const image = normalizeOptionalString(formData.get("image"));
  const roleRaw = normalizeOptionalString(formData.get("role"));
  if (!roleRaw || !USER_ROLES.includes(roleRaw as UserRole)) {
    return { error: "Valid role is required" };
  }

  try {
    const [updated] = await db
      .update(users)
      .set({
        email,
        name,
        username,
        gh_username: ghUsername,
        image,
        role: roleRaw as UserRole,
      })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!updated) return { error: "User not found" };
    revalidateSettingsPath("/settings/users");
    return { ok: true };
  } catch (error: any) {
    if (error?.code === "23505") {
      return { error: "Another user already uses that email" };
    }
    return { error: error?.message || "Failed to update user" };
  }
};

export const deleteUserAdmin = async (formData: FormData) => {
  const session = await requireAdminSession();

  const id = normalizeOptionalString(formData.get("id"));
  if (!id) return { error: "Missing user id" };
  if (id === session.user.id) return { error: "You cannot delete your own account" };

  const ownedSite = await db.query.sites.findFirst({
    where: eq(sites.userId, id),
    columns: { id: true },
  });
  if (ownedSite) {
    return { error: "Cannot delete user with owned sites. Reassign/delete sites first." };
  }

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (!deleted) return { error: "User not found" };
  revalidateSettingsPath("/settings/users");
  return { ok: true };
};

export const listOauthProviderSettings = async () => {
  await requireAdminSession();
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(
      inArray(
        cmsSettings.key,
        OAUTH_PROVIDER_IDS.map((id) => `oauth_provider_${id}_enabled`),
      ),
    );

  const byId = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return OAUTH_PROVIDER_IDS.map((id) => {
    const key = `oauth_provider_${id}_enabled`;
    const enabled = byId[key] ? byId[key] === "true" : true;
    return { id, key, enabled };
  });
};

export const updateOauthProviderSettings = async (formData: FormData) => {
  await requireAdminSession();

  for (const id of OAUTH_PROVIDER_IDS) {
    const key = `oauth_provider_${id}_enabled`;
    const enabled = formData.get(key) === "on";
    await db
      .insert(cmsSettings)
      .values({ key, value: enabled ? "true" : "false" })
      .onConflictDoUpdate({
        target: cmsSettings.key,
        set: { value: enabled ? "true" : "false" },
      });
  }

  revalidateSettingsPath("/settings/users");
};

export const getCmsDefaultsSettings = async () => {
  await requireAdminSession();
  return getReadingSettings();
};

export const updateCmsDefaultsSettings = async (formData: FormData) => {
  await requireAdminSession();
  const enabled = formData.get("random_default_images_enabled") === "on";
  const siteUrlRaw = (formData.get("site_url") as string | null) ?? "";
  await Promise.all([
    setRandomDefaultImagesEnabled(enabled),
    setSiteUrlSetting(siteUrlRaw),
  ]);
  revalidateSettingsPath("/settings/reading");
};

export const getReadingSettingsAdmin = async () => {
  await requireAdminSession();
  return getReadingSettings();
};

export const updateReadingSettings = async (formData: FormData) => {
  await requireAdminSession();
  const randomDefaultsEnabled = formData.get("random_default_images_enabled") === "on";
  const indexingEnabled = formData.get("seo_indexing_enabled") === "on";
  const mainHeaderEnabled = formData.get("main_header_enabled") === "on";
  const mainHeaderShowNetworkSites = formData.get("main_header_show_network_sites") === "on";
  const siteUrlRaw = (formData.get("site_url") as string | null) ?? "";
  const seoMetaTitle = ((formData.get("seo_meta_title") as string | null) ?? "").trim();
  const seoMetaDescription = ((formData.get("seo_meta_description") as string | null) ?? "").trim();

  await Promise.all([
    setRandomDefaultImagesEnabled(randomDefaultsEnabled),
    setSiteUrlSetting(siteUrlRaw),
    setBooleanSetting(SEO_INDEXING_ENABLED_KEY, indexingEnabled),
    setTextSetting(SEO_META_TITLE_KEY, seoMetaTitle),
    setTextSetting(SEO_META_DESCRIPTION_KEY, seoMetaDescription),
    setBooleanSetting(MAIN_HEADER_ENABLED_KEY, mainHeaderEnabled),
    setBooleanSetting(MAIN_HEADER_SHOW_NETWORK_SITES_KEY, mainHeaderShowNetworkSites),
  ]);

  revalidateSettingsPath("/settings/reading");
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
};

export const resetCmsCache = async () => {
  await requireAdminSession();

  const allSites = await db
    .select({
      subdomain: sites.subdomain,
      customDomain: sites.customDomain,
    })
    .from(sites);

  for (const site of allSites) {
    const subdomain = site.subdomain;
    const customDomain = site.customDomain;
    if (subdomain) {
      revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-metadata`, "max");
      revalidateTag(`${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-posts`, "max");
    }
    if (customDomain) {
      revalidateTag(`${customDomain}-metadata`, "max");
      revalidateTag(`${customDomain}-posts`, "max");
    }
  }

  const allPosts = await db
    .select({
      slug: posts.slug,
      subdomain: sites.subdomain,
      customDomain: sites.customDomain,
    })
    .from(posts)
    .leftJoin(sites, eq(posts.siteId, sites.id));

  for (const post of allPosts) {
    if (post.subdomain) {
      revalidateTag(`${post.subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}-${post.slug}`, "max");
    }
    if (post.customDomain) {
      revalidateTag(`${post.customDomain}-${post.slug}`, "max");
    }
  }

  revalidatePath("/", "layout");
  revalidatePath("/app", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
};

export const getWritingSettingsAdmin = async () => {
  await requireAdminSession();
  return getWritingSettings();
};

export const updateWritingSettings = async (formData: FormData) => {
  await requireAdminSession();
  const permalinkStyle = ((formData.get("writing_permalink_style") as string | null) ?? "post-name").trim() || "post-name";
  const editorMode = ((formData.get("writing_editor_mode") as string | null) ?? "rich-text").trim() || "rich-text";
  const categoryBaseRaw = ((formData.get("writing_category_base") as string | null) ?? "c").trim().toLowerCase();
  const tagBaseRaw = ((formData.get("writing_tag_base") as string | null) ?? "t").trim().toLowerCase();
  const categoryBase = categoryBaseRaw === "c" ? "c" : "c";
  const tagBase = tagBaseRaw === "t" ? "t" : "t";

  await Promise.all([
    setTextSetting(WRITING_PERMALINK_STYLE_KEY, permalinkStyle),
    setTextSetting(WRITING_EDITOR_MODE_KEY, editorMode),
    setTextSetting(WRITING_CATEGORY_BASE_KEY, categoryBase),
    setTextSetting(WRITING_TAG_BASE_KEY, tagBase),
  ]);

  revalidateSettingsPath("/settings/writing");
};

export const getSiteReadingSettingsAdmin = async (siteIdRaw: string) => {
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const [randomDefaults, mainHeaderEnabled, showNetworkSites, writingSettings, domains] =
    await Promise.all([
      getSiteBooleanSetting(site.id, "random_default_images_enabled", true),
      getSiteBooleanSetting(site.id, MAIN_HEADER_ENABLED_KEY, true),
      getSiteBooleanSetting(site.id, MAIN_HEADER_SHOW_NETWORK_SITES_KEY, false),
      getSiteWritingSettings(site.id),
      getAllDataDomains(site.id),
    ]);

  return {
    siteId: site.id,
    randomDefaultsEnabled: randomDefaults,
    mainHeaderEnabled,
    showNetworkSites,
    writingSettings,
    dataDomains: domains.map((domain) => ({ key: domain.key, label: domain.label })),
  };
};

export const updateSiteReadingSettings = async (formData: FormData) => {
  const siteIdRaw = (formData.get("siteId") as string | null) ?? "";
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const randomDefaultsEnabled = formData.get("random_default_images_enabled") === "on";
  const mainHeaderEnabled = formData.get("main_header_enabled") === "on";
  const mainHeaderShowNetworkSites = formData.get("main_header_show_network_sites") === "on";
  const permalinkModeRaw = ((formData.get("writing_permalink_mode") as string | null) ?? "default").trim().toLowerCase();
  const permalinkMode = permalinkModeRaw === "custom" ? "custom" : "default";
  const singlePattern = ((formData.get("writing_single_pattern") as string | null) ?? "/%domain%/%slug%").trim() || "/%domain%/%slug%";
  const listPattern = ((formData.get("writing_list_pattern") as string | null) ?? "/%domain_plural%").trim() || "/%domain_plural%";
  const noDomainPrefix = ((formData.get("writing_no_domain_prefix") as string | null) ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-]/g, "");
  const noDomainDataDomain = ((formData.get("writing_no_domain_data_domain") as string | null) ?? "post")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "") || "post";

  await Promise.all([
    setSiteBooleanSetting(site.id, "random_default_images_enabled", randomDefaultsEnabled),
    setSiteBooleanSetting(site.id, MAIN_HEADER_ENABLED_KEY, mainHeaderEnabled),
    setSiteBooleanSetting(site.id, MAIN_HEADER_SHOW_NETWORK_SITES_KEY, mainHeaderShowNetworkSites),
    setSiteTextSetting(site.id, WRITING_PERMALINK_MODE_KEY, permalinkMode),
    setSiteTextSetting(site.id, WRITING_SINGLE_PATTERN_KEY, singlePattern),
    setSiteTextSetting(site.id, WRITING_LIST_PATTERN_KEY, listPattern),
    setSiteTextSetting(site.id, WRITING_NO_DOMAIN_PREFIX_KEY, noDomainPrefix),
    setSiteTextSetting(site.id, WRITING_NO_DOMAIN_DATA_DOMAIN_KEY, noDomainDataDomain),
  ]);

  revalidatePath(`/site/${site.id}/settings/reading`);
  return { ok: true };
};

export const getSiteSeoSettingsAdmin = async (siteIdRaw: string) => {
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const [indexingEnabled, seoMetaTitle, seoMetaDescription, socialMetaTitle, socialMetaDescription, socialMetaImage] =
    await Promise.all([
      getSiteBooleanSetting(site.id, SEO_INDEXING_ENABLED_KEY, true),
      getSiteTextSetting(site.id, SEO_META_TITLE_KEY, ""),
      getSiteTextSetting(site.id, SEO_META_DESCRIPTION_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_TITLE_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_DESCRIPTION_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_IMAGE_KEY, ""),
    ]);

  const defaultDescription = (site.heroSubtitle || site.description || "").trim();

  return {
    siteId: site.id,
    defaults: {
      metaTitle: (site.name || "").trim(),
      metaDescription: defaultDescription,
      socialTitle: (site.name || "").trim(),
      socialDescription: defaultDescription,
      socialImage: (site.image || site.logo || "").trim(),
    },
    indexingEnabled,
    seoMetaTitle,
    seoMetaDescription,
    socialMetaTitle,
    socialMetaDescription,
    socialMetaImage,
  };
};

export const updateSiteSeoSettings = async (formData: FormData) => {
  const siteIdRaw = (formData.get("siteId") as string | null) ?? "";
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const indexingEnabled = formData.get("seo_indexing_enabled") === "on";
  const seoMetaTitle = ((formData.get("seo_meta_title") as string | null) ?? "").trim();
  const seoMetaDescription = ((formData.get("seo_meta_description") as string | null) ?? "").trim();
  const socialMetaTitle = ((formData.get("social_meta_title") as string | null) ?? "").trim();
  const socialMetaDescription = ((formData.get("social_meta_description") as string | null) ?? "").trim();
  const socialMetaImage = ((formData.get("social_meta_image") as string | null) ?? "").trim();

  await Promise.all([
    setSiteBooleanSetting(site.id, SEO_INDEXING_ENABLED_KEY, indexingEnabled),
    setSiteTextSetting(site.id, SEO_META_TITLE_KEY, seoMetaTitle),
    setSiteTextSetting(site.id, SEO_META_DESCRIPTION_KEY, seoMetaDescription),
    setSiteTextSetting(site.id, SOCIAL_META_TITLE_KEY, socialMetaTitle),
    setSiteTextSetting(site.id, SOCIAL_META_DESCRIPTION_KEY, socialMetaDescription),
    setSiteTextSetting(site.id, SOCIAL_META_IMAGE_KEY, socialMetaImage),
  ]);

  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").replace(/:\d+$/, "");
  const tagDomains = [
    site.subdomain ? `${site.subdomain}.${rootDomain}` : "",
    site.customDomain || "",
  ].filter(Boolean);
  for (const domain of tagDomains) {
    revalidateTag(`${domain}-metadata`, "max");
  }

  revalidatePath(`/site/${site.id}/settings/seo`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
  return { ok: true };
};

export const getSiteEditorSettingsAdmin = async (siteIdRaw: string) => {
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;
  const writing = await getSiteWritingSettings(site.id);
  return {
    siteId: site.id,
    editorMode: writing.editorMode,
  };
};

export const updateSiteEditorSettings = async (formData: FormData) => {
  const siteIdRaw = (formData.get("siteId") as string | null) ?? "";
  const owned = await requireOwnedSite(siteIdRaw);
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const editorMode = ((formData.get("writing_editor_mode") as string | null) ?? "rich-text").trim() || "rich-text";
  await setSiteTextSetting(site.id, WRITING_EDITOR_MODE_KEY, editorMode);

  revalidatePath(`/site/${site.id}/settings/writing`);
  return { ok: true };
};

export const getScheduleSettingsAdmin = async () => {
  await requireAdminSession();
  const [settings, schedules, allSites] = await Promise.all([
    getScheduleSettings(),
    listScheduleEntries({ includeDisabled: true }),
    db.query.sites.findMany({
      columns: { id: true, name: true, subdomain: true, customDomain: true, isPrimary: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    }),
  ]);

  const siteById = new Map(allSites.map((site) => [site.id, site]));
  const rows = schedules.map((entry: ScheduleEntry) => ({
    ...entry,
    site:
      entry.siteId && siteById.has(entry.siteId)
        ? siteById.get(entry.siteId)
        : null,
  }));

  return {
    ...settings,
    schedules: rows,
    sites: allSites,
  };
};

export const updateScheduleSettings = async (formData: FormData) => {
  await requireAdminSession();
  const schedulesEnabled = formData.get("schedules_enabled") === "on";
  const pingSitemap = formData.get("schedules_ping_sitemap") === "on";

  await Promise.all([
    setBooleanSetting(SCHEDULES_ENABLED_KEY, schedulesEnabled),
    setBooleanSetting(SCHEDULES_PING_SITEMAP_KEY, pingSitemap),
  ]);

  revalidateSettingsPath("/settings/schedules");
};

function normalizeOwnerType(value: FormDataEntryValue | null): SchedulerOwnerType {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "plugin" || raw === "theme" || raw === "core") return raw;
  return "core";
}

export const createScheduledActionAdmin = async (formData: FormData) => {
  await requireAdminSession();
  const ownerType = normalizeOwnerType(formData.get("ownerType"));
  const ownerId = String(formData.get("ownerId") || "core").trim() || "core";
  const siteIdRaw = String(formData.get("siteId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const actionKey = String(formData.get("actionKey") || "").trim();
  const runEveryMinutes = Number(formData.get("runEveryMinutes") || "60");
  const enabled = formData.get("enabled") === "on";
  const payloadRaw = String(formData.get("payload") || "").trim();

  const payload = payloadRaw
    ? (() => {
        try {
          const parsed = JSON.parse(payloadRaw);
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          throw new Error("Payload must be valid JSON");
        }
      })()
    : {};

  await createScheduleEntry(ownerType, ownerId, {
    siteId: siteIdRaw || null,
    name,
    actionKey,
    payload,
    enabled,
    runEveryMinutes,
  });

  revalidateSettingsPath("/settings/schedules");
};

export const updateScheduledActionAdmin = async (formData: FormData) => {
  await requireAdminSession();
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing schedule id");
  const siteIdRaw = String(formData.get("siteId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const actionKey = String(formData.get("actionKey") || "").trim();
  const runEveryMinutes = Number(formData.get("runEveryMinutes") || "60");
  const enabled = formData.get("enabled") === "on";
  const payloadRaw = String(formData.get("payload") || "").trim();
  const payload = payloadRaw
    ? (() => {
        try {
          const parsed = JSON.parse(payloadRaw);
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          throw new Error("Payload must be valid JSON");
        }
      })()
    : {};

  await updateScheduleEntry(
    id,
    {
      siteId: siteIdRaw || null,
      name,
      actionKey,
      payload,
      enabled,
      runEveryMinutes,
    },
    { isAdmin: true },
  );
  revalidateSettingsPath("/settings/schedules");
};

export const deleteScheduledActionAdmin = async (formData: FormData) => {
  await requireAdminSession();
  const id = String(formData.get("id") || "").trim();
  if (!id) return;
  await deleteScheduleEntry(id, { isAdmin: true });
  revalidateSettingsPath("/settings/schedules");
};
