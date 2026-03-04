"use server";

import { getSession, MIMIC_ACTOR_COOKIE, MIMIC_TARGET_COOKIE } from "@/lib/auth";
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
  SOCIAL_META_IMAGE_MEDIA_ID_KEY,
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
  WRITING_ENABLE_COMMENTS_KEY,
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
import { cookies } from "next/headers";
import { withSiteAuth } from "./auth";
import db from "./db";
import { SelectSite, accounts, sites, users } from "./schema";
import { dataDomains, domainPostMeta, domainPosts, siteDataDomains, termRelationships, termTaxonomies, termTaxonomyDomains, termTaxonomyMeta, terms } from "./schema";
import { singularizeLabel } from "./data-domain-labels";
import {
  USER_ROLES,
  SITE_CAPABILITIES,
  type SiteCapability,
  getCapabilityMatrix, listRbacRoles, saveRoleCapabilities, createRbacRole, deleteRbacRole, SYSTEM_ROLES,
} from "./rbac";
import {
  acquireSchedulerLock,
  createScheduleEntry,
  deleteScheduleEntry,
  listScheduleEntries,
  listScheduleRunAudits,
  releaseSchedulerLock,
  runScheduleEntryNow,
  updateScheduleEntry,
  type ScheduleEntry,
  type SchedulerOwnerType,
} from "./scheduler";
import { emitDomainEvent } from "@/lib/domain-dispatch";
import { hashPassword } from "@/lib/password";
import { listSiteUsers, upsertSiteUserRole } from "@/lib/site-user-tables";
import { createKernelForRequest, listPluginsWithState } from "@/lib/plugin-runtime";
import type { ProfileSection, ProfileSectionRow } from "@/lib/profile-contracts";
import { getUserMetaValue, setUserMetaValue } from "@/lib/user-meta";
import { DEFAULT_CORE_DOMAIN_KEYS, ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import {
  dataDomainDescriptionSettingKey,
  dataDomainKeySettingKey,
  dataDomainLabelSettingKey,
  dataDomainPermalinkSettingKey,
  dataDomainShowInMenuSettingKey,
  resolveDataDomainDescription,
} from "@/lib/data-domain-descriptions";
import { domainPluralSegment } from "@/lib/permalink";
import {
  userCan,
  canUserMutateDomainPost,
} from "@/lib/authorization";
import { canTransitionContentState, stateFromPublishedFlag } from "@/lib/content-state-engine";
import { setDomainPostPublishedState } from "@/lib/content-lifecycle";
import { getSettingsByKeys, listSettingsByLikePatterns, setSettingByKey } from "@/lib/settings-store";
import { getCommentProviderWritingOptions, hasEnabledCommentProvider } from "@/lib/comments-spine";
import { getAdminPathAlias } from "@/lib/admin-path";

function emitCmsLifecycleEvent(input: {
  name: "content_published" | "content_deleted" | "custom_event";
  siteId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const siteId = typeof input.siteId === "string" && input.siteId.trim() ? input.siteId : undefined;
  return emitDomainEvent({
    version: 1,
    name: input.name,
    timestamp: new Date().toISOString(),
    siteId,
    actorType: "admin",
    payload: input.payload || {},
    meta: {
      source: "server_action",
    },
  }).catch(() => undefined);
}

const normalizeSiteScope = (siteId: string) => String(siteId || "").trim();

export const getAllCategories = async (siteId: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return [];
  return db
    .select({
      id: termTaxonomies.id,
      name: terms.name,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, "category")))
    .orderBy(asc(terms.name));
};
export const createCategoryByName = async (siteId: string, name: string, parentId?: number | null) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return { error: "Site id is required" };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Category name is required" };
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const existing = await db
    .select({
      id: termTaxonomies.id,
      name: terms.name,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(
      and(
        eq(termTaxonomies.siteId, normalizedSiteId),
        eq(termTaxonomies.taxonomy, "category"),
        eq(terms.slug, slug),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const [reusedTerm] = await db.select().from(terms).where(eq(terms.slug, slug)).limit(1);
  const [createdTerm] = await db
    .insert(terms)
    .values({ name: trimmed, slug: slug || `term-${nanoid().toLowerCase()}` })
    .returning()
    .catch(async () => db.select().from(terms).where(eq(terms.slug, slug)).limit(1));
  const term = reusedTerm || createdTerm;
  if (!term) return { error: "Failed to create category term" };

  const [createdTaxonomy] = await db
    .insert(termTaxonomies)
    .values({
      siteId: normalizedSiteId,
      termId: term.id,
      taxonomy: "category",
      parentId: parentId ?? null,
    })
    .returning();

  revalidateDomainAndTaxonomyCaches();
  return { id: createdTaxonomy.id, name: term.name };
};
export const getAllTags = async (siteId: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return [];
  return db
    .select({
      id: termTaxonomies.id,
      name: terms.name,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, "tag")))
    .orderBy(asc(terms.name));
};
export const createTagByName = async (siteId: string, name: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return { error: "Site id is required" };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Tag name is required" };
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const existing = await db
    .select({
      id: termTaxonomies.id,
      name: terms.name,
    })
    .from(termTaxonomies)
    .innerJoin(terms, eq(termTaxonomies.termId, terms.id))
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, "tag"), eq(terms.slug, slug)))
    .limit(1);
  if (existing[0]) return existing[0];

  const [reusedTerm] = await db.select().from(terms).where(eq(terms.slug, slug)).limit(1);
  const [createdTerm] = await db
    .insert(terms)
    .values({ name: trimmed, slug: slug || `term-${nanoid().toLowerCase()}` })
    .returning()
    .catch(async () => db.select().from(terms).where(eq(terms.slug, slug)).limit(1));
  const term = reusedTerm || createdTerm;
  if (!term) return { error: "Failed to create tag term" };

  const [createdTaxonomy] = await db
    .insert(termTaxonomies)
    .values({
      siteId: normalizedSiteId,
      termId: term.id,
      taxonomy: "tag",
    })
    .returning();

  revalidateDomainAndTaxonomyCaches();
  return { id: createdTaxonomy.id, name: term.name };
};
export const getAllMetaKeys = async () => {
  try {
    const rows = await db.select({ key: domainPostMeta.key }).from(domainPostMeta).orderBy(asc(domainPostMeta.key));
    const unique = Array.from(new Set(rows.map((row) => row.key))).filter(Boolean);
    return unique;
  } catch {
    return [];
  }
};
const toDomainKey = (label: string) =>
  singularizeLabel(
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60),
  ) || `domain_${nanoid().toLowerCase()}`;

export const getAllDataDomains = async (siteId?: string) => {
  await ensureDefaultCoreDataDomains();
  const rows = await db.select().from(dataDomains).orderBy(asc(dataDomains.label));
  let usageRows: Array<{ dataDomainId: number; usageCount: number }> = [];
  try {
    const usageBase = db
      .select({
        dataDomainId: domainPosts.dataDomainId,
        usageCount: sql<number>`count(*)::int`,
      })
      .from(domainPosts);
    usageRows = siteId
      ? await usageBase.where(eq(domainPosts.siteId, siteId)).groupBy(domainPosts.dataDomainId)
      : await usageBase.groupBy(domainPosts.dataDomainId);
  } catch {
    usageRows = [];
  }
  const usageMap = new Map(usageRows.map((row) => [row.dataDomainId, row.usageCount]));
  if (!siteId) {
    return rows.map((row) => ({
      ...row,
      usageCount: usageMap.get(row.id) ?? 0,
    }));
  }

  let assignments: Array<{ dataDomainId: number; isActive: boolean; description: string }> = [];
  try {
    assignments = await db
      .select({
        dataDomainId: siteDataDomains.dataDomainId,
        isActive: siteDataDomains.isActive,
        description: siteDataDomains.description,
      })
      .from(siteDataDomains)
      .where(eq(siteDataDomains.siteId, siteId));
  } catch {
    assignments = [];
  }

  const assignmentMap = new Map(assignments.map((row) => [row.dataDomainId, row]));
  const defaultCoreKeys = new Set<string>(DEFAULT_CORE_DOMAIN_KEYS);
  const visibleRows = rows.filter((row) => defaultCoreKeys.has(row.key) || assignmentMap.has(row.id));
  const siteDescriptionRows =
    siteId
      ? await Promise.all(
          visibleRows.map(async (row) => {
            const value = await getSiteTextSetting(siteId, dataDomainDescriptionSettingKey(row.id), "");
            return [row.id, value] as const;
          }),
        )
      : [];
  const sitePermalinkRows =
    siteId
      ? await Promise.all(
          visibleRows.map(async (row) => {
            const value = await getSiteTextSetting(siteId, dataDomainPermalinkSettingKey(row.id), "");
            return [row.id, value] as const;
          }),
        )
      : [];
  const siteLabelRows =
    siteId
      ? await Promise.all(
          visibleRows.map(async (row) => {
            const value = await getSiteTextSetting(siteId, dataDomainLabelSettingKey(row.id), "");
            return [row.id, value] as const;
          }),
        )
      : [];
  const siteKeyRows =
    siteId
      ? await Promise.all(
          visibleRows.map(async (row) => {
            const value = await getSiteTextSetting(siteId, dataDomainKeySettingKey(row.id), "");
            return [row.id, value] as const;
          }),
        )
      : [];
  const siteShowInMenuRows =
    siteId
      ? await Promise.all(
          visibleRows.map(async (row) => {
            const value = await getSiteTextSetting(siteId, dataDomainShowInMenuSettingKey(row.id), "");
            return [row.id, value] as const;
          }),
        )
      : [];
  const siteDescriptionMap = new Map(siteDescriptionRows);
  const sitePermalinkMap = new Map(sitePermalinkRows);
  const siteLabelMap = new Map(siteLabelRows);
  const siteKeyMap = new Map(siteKeyRows);
  const siteShowInMenuMap = new Map(siteShowInMenuRows);
  return visibleRows.map((row) => ({
      ...row,
      key: String(siteKeyMap.get(row.id) || "").trim() || row.key,
      label: String(siteLabelMap.get(row.id) || "").trim() || row.label,
      settings: {
        ...((row.settings as any) || {}),
        showInMenu: (() => {
          const raw = String(siteShowInMenuMap.get(row.id) || "").trim().toLowerCase();
          if (!raw) return (row.settings as any)?.showInMenu ?? true;
          return !(raw === "0" || raw === "false" || raw === "off");
        })(),
      },
      assigned: defaultCoreKeys.has(row.key) ? true : assignmentMap.has(row.id),
      isActive: defaultCoreKeys.has(row.key) ? true : assignmentMap.get(row.id)?.isActive ?? false,
      description: resolveDataDomainDescription({
        domainKey: String(siteKeyMap.get(row.id) || "").trim() || row.key,
        siteDescription: siteDescriptionMap.get(row.id) || assignmentMap.get(row.id)?.description || "",
        globalDescription: row.description || "",
      }),
      permalink:
        String(sitePermalinkMap.get(row.id) || "").trim() ||
        String((row.settings as any)?.permalink || "").trim() ||
        domainPluralSegment(String(siteKeyMap.get(row.id) || "").trim() || row.key),
      usageCount: usageMap.get(row.id) ?? 0,
  }));
};

export const getSiteDataDomainByKey = async (siteId: string, domainKey: string) => {
  await ensureDefaultCoreDataDomains();
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
  if (DEFAULT_CORE_DOMAIN_KEYS.includes(row.key as (typeof DEFAULT_CORE_DOMAIN_KEYS)[number])) {
    return { ...row, isActive: true };
  }
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
  showInMenu?: boolean;
}) => {
  if (!input.siteId) return { error: "Site-scoped Data Domains are required. Provide siteId." };
  const session = await getSession();
  if (!session?.user?.id) return { error: "Not authenticated" };
  const allowed = await userCan("site.settings.write", session.user.id, { siteId: input.siteId });
  if (!allowed) return { error: "Not authorized" };

  const trimmed = input.label.trim();
  if (!trimmed) return { error: "Data Domain label is required" };
  const canonicalLabel = trimmed;
  const existingByLabel = await db.select().from(dataDomains).where(eq(dataDomains.label, canonicalLabel)).limit(1);
  if (existingByLabel[0]) return existingByLabel[0];

  const key = toDomainKey(canonicalLabel);
  const existingByKey = await db.select().from(dataDomains).where(eq(dataDomains.key, key)).limit(1);
  if (existingByKey[0]) return existingByKey[0];

  const safeKey = key.replace(/[^a-z0-9-]/g, "").replace(/^-+/, "");
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  const contentTable = `${normalizedPrefix}site_domain_posts`;
  const metaTable = `${normalizedPrefix}site_domain_post_meta`;
  const extraFields = Array.isArray(input.fields) ? input.fields : [];
  if (!safeKey) return { error: "Invalid Data Domain key" };

  const [created] = await db.insert(dataDomains).values({
    key,
    label: canonicalLabel,
    contentTable,
    metaTable,
    description: "",
    settings: {
      fields: extraFields,
      storageModel: "shared_site_domain_posts",
      showInMenu: input.showInMenu !== false,
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
  revalidateDomainAndTaxonomyCaches({ siteId: input.siteId || null });
  return created;
};

export const createDataDomainByLabel = async (label: string) => createDataDomain({ label });

export const updateDataDomain = async (input: {
  id: number;
  label: string;
  key?: string;
  permalink?: string;
  description?: string;
  showInMenu?: boolean;
  siteId?: string;
}) => {
  if (!input.siteId) return { error: "Site-scoped Data Domains are required. Provide siteId." };
  const normalizePermalinkSegment = (value: string) =>
    String(value || "")
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\s+/g, "-");
  const session = await getSession();
  if (!session?.user?.id) return { error: "Not authenticated" };
  const allowed = await userCan("site.settings.write", session.user.id, { siteId: input.siteId });
  if (!allowed) return { error: "Not authorized" };

  const trimmed = input.label.trim();
  if (!trimmed) return { error: "Data Domain label is required" };
  const canonicalLabel = trimmed;

  const [existing] = await db
    .select({
      key: dataDomains.key,
      label: dataDomains.label,
      description: dataDomains.description,
      settings: dataDomains.settings,
    })
    .from(dataDomains)
    .where(eq(dataDomains.id, input.id))
    .limit(1);
  if (!existing) {
    return { error: "Data Domain not found" };
  }

  const nextSiteDescription = String(input.description ?? "").trim();
  const nextSitePermalink = normalizePermalinkSegment(String(input.permalink ?? ""));
  const currentSiteKey = String(
    await getSiteTextSetting(input.siteId, dataDomainKeySettingKey(input.id), existing.key),
  ).trim() || existing.key;
  const submittedKey = String(input.key ?? "").trim();
  const keyChanged = submittedKey.length > 0 && submittedKey !== currentSiteKey;
  const normalizedChangedKey = keyChanged ? toDomainKey(submittedKey) : undefined;
  if (keyChanged && !normalizedChangedKey) {
    return { error: "Data Domain key is required" };
  }
  const nextSiteKey = normalizedChangedKey || currentSiteKey;
  const nextSiteLabel = canonicalLabel || existing.label;
  await setSiteTextSetting(input.siteId, dataDomainDescriptionSettingKey(input.id), nextSiteDescription);
  await setSiteTextSetting(input.siteId, dataDomainPermalinkSettingKey(input.id), nextSitePermalink);
  await setSiteTextSetting(input.siteId, dataDomainKeySettingKey(input.id), nextSiteKey);
  await setSiteTextSetting(input.siteId, dataDomainLabelSettingKey(input.id), nextSiteLabel);
  await setSiteTextSetting(
    input.siteId,
    dataDomainShowInMenuSettingKey(input.id),
    input.showInMenu === false ? "0" : "1",
  );
  await db
    .insert(siteDataDomains)
    .values({
      siteId: input.siteId,
      dataDomainId: input.id,
      isActive: true,
      description: nextSiteDescription,
    })
    .onConflictDoUpdate({
      target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
      set: {
        description: nextSiteDescription,
      },
    });
  revalidateDomainAndTaxonomyCaches();
  return {
    id: input.id,
    key: nextSiteKey,
    label: nextSiteLabel,
    description: nextSiteDescription,
  };
};

const sanitizeDbIdentifier = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_");

export const deleteDataDomain = async (input: number | { id: number; siteId?: string; confirmText?: string }) => {
  const targetId = typeof input === "number" ? input : input.id;
  const siteId = typeof input === "number" ? undefined : String(input.siteId || "").trim() || undefined;
  const confirmText = typeof input === "number" ? "delete" : String(input.confirmText || "").trim().toLowerCase();
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  if (!siteId) return { error: "Site-scoped Data Domains are required. Provide siteId." };
  if (confirmText !== "delete") {
    return { error: "Delete confirmation required" };
  }

  const session = await getSession();
  if (!session?.user?.id) return { error: "Not authenticated" };
  const allowed = await userCan("site.settings.write", session.user.id, { siteId });
  if (!allowed) return { error: "Not authorized" };

  const [domain] = await db.select().from(dataDomains).where(eq(dataDomains.id, targetId)).limit(1);
  if (!domain) return { error: "Data Domain not found" };
  if (DEFAULT_CORE_DOMAIN_KEYS.includes(domain.key as (typeof DEFAULT_CORE_DOMAIN_KEYS)[number])) {
    return { error: "Core Post Types cannot be deleted" };
  }

  if (siteId) {
    const [siteAssignment] = await db
      .select({ isActive: siteDataDomains.isActive })
      .from(siteDataDomains)
      .where(and(eq(siteDataDomains.siteId, siteId), eq(siteDataDomains.dataDomainId, targetId)))
      .limit(1);
    if (siteAssignment?.isActive) {
      return { error: "Deactivate this Post Type before deleting it." };
    }

    await db.transaction(async (tx) => {
      const scopedPostIds = await tx
        .select({ id: domainPosts.id })
        .from(domainPosts)
        .where(and(eq(domainPosts.dataDomainId, targetId), eq(domainPosts.siteId, siteId)));
      if (scopedPostIds.length > 0) {
        await tx
          .delete(domainPostMeta)
          .where(inArray(domainPostMeta.domainPostId, scopedPostIds.map((row) => row.id)));
      }

      await tx
        .delete(domainPosts)
        .where(and(eq(domainPosts.dataDomainId, targetId), eq(domainPosts.siteId, siteId)));
      await tx
        .delete(siteDataDomains)
        .where(and(eq(siteDataDomains.dataDomainId, targetId), eq(siteDataDomains.siteId, siteId)));
    });

    await setSiteTextSetting(siteId, dataDomainDescriptionSettingKey(targetId), "");

    const [remainingAssignment] = await db
      .select({ dataDomainId: siteDataDomains.dataDomainId })
      .from(siteDataDomains)
      .where(eq(siteDataDomains.dataDomainId, targetId))
      .limit(1);
    const [remainingPost] = await db
      .select({ id: domainPosts.id })
      .from(domainPosts)
      .where(eq(domainPosts.dataDomainId, targetId))
      .limit(1);

    if (remainingAssignment || remainingPost) {
      const adminBasePath = `/app/${getAdminPathAlias()}`;
      revalidatePath(`${adminBasePath}/site/${encodeURIComponent(siteId)}/settings/domains`);
      revalidateDomainAndTaxonomyCaches({ siteId });
      return { ok: true };
    }
  }

  await db.transaction(async (tx) => {
    const domainPostIds = await tx
      .select({ id: domainPosts.id })
      .from(domainPosts)
      .where(eq(domainPosts.dataDomainId, targetId));
    if (domainPostIds.length > 0) {
      await tx
        .delete(domainPostMeta)
        .where(inArray(domainPostMeta.domainPostId, domainPostIds.map((row) => row.id)));
    }
    await tx.delete(domainPosts).where(eq(domainPosts.dataDomainId, targetId));
    await tx.delete(siteDataDomains).where(eq(siteDataDomains.dataDomainId, targetId));
    await tx.delete(termTaxonomyDomains).where(eq(termTaxonomyDomains.dataDomainId, targetId));
    await tx.delete(dataDomains).where(eq(dataDomains.id, targetId));

    const sharedContentTable = `${normalizedPrefix}site_domain_posts`;
    const sharedMetaTable = `${normalizedPrefix}site_domain_post_meta`;
    const safeContentTable = sanitizeDbIdentifier(domain.contentTable);
    const safeMetaTable = sanitizeDbIdentifier(domain.metaTable);
    if (safeMetaTable !== sharedMetaTable && safeContentTable !== sharedContentTable) {
      await tx.execute(sql.raw(`DROP TABLE IF EXISTS "${safeMetaTable}"`));
      await tx.execute(sql.raw(`DROP TABLE IF EXISTS "${safeContentTable}"`));
    }
  });
  if (siteId) {
    const adminBasePath = `/app/${getAdminPathAlias()}`;
    revalidatePath(`${adminBasePath}/site/${encodeURIComponent(siteId)}/settings/domains`);
  }
  revalidateDomainAndTaxonomyCaches({ siteId: siteId || null });
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
  const allowed = await userCan("site.settings.write", session.user.id, { siteId: input.siteId });
  if (!allowed) {
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
  revalidateDomainAndTaxonomyCaches({ siteId: input.siteId });
  return { ok: true };
};

export const registerCustomTaxonomyForDataDomain = async (input: {
  siteId: string;
  dataDomainId: number;
  taxonomy: string;
  label: string;
  description?: string;
}) => {
  const siteId = normalizeSiteScope(input.siteId);
  if (!siteId) return { error: "siteId is required" };
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
        siteId,
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
          .where(
            and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.termId, term.id), eq(termTaxonomies.taxonomy, taxonomy)),
          )
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
  siteId: string;
  taxonomy: string;
  termTaxonomyId: number;
  parentId: number | null;
}) => {
  const { siteId, taxonomy, termTaxonomyId, parentId } = input;
  if (parentId === null) return { ok: true as const };
  if (parentId === termTaxonomyId) return { error: "A term cannot be its own parent." };

  const taxonomyRows = await db
    .select({
      id: termTaxonomies.id,
      parentId: termTaxonomies.parentId,
    })
    .from(termTaxonomies)
    .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.taxonomy, taxonomy)));

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

async function ensureDefaultCategoryTaxonomy(siteId: string) {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return;
  const existingCategory = await db
    .select({ id: termTaxonomies.id })
    .from(termTaxonomies)
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, "category")))
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
      siteId: normalizedSiteId,
      termId,
      taxonomy: "category",
      description: "Default category taxonomy",
      count: 0,
    })
    .onConflictDoNothing();
}

export const getTaxonomyOverview = async (siteId: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return [];
  await ensureDefaultCategoryTaxonomy(normalizedSiteId);

  const rows = await db
    .select({
      taxonomy: termTaxonomies.taxonomy,
      termCount: sql<number>`count(*)::int`,
      usageCount: sql<number>`coalesce(sum(${termTaxonomies.count}), 0)::int`,
    })
    .from(termTaxonomies)
    .where(eq(termTaxonomies.siteId, normalizedSiteId))
    .groupBy(termTaxonomies.taxonomy)
    .orderBy(termTaxonomies.taxonomy);

  const merged = new Map<string, { taxonomy: string; termCount: number; usageCount: number }>();
  for (const row of rows) merged.set(row.taxonomy, row);
  if (!merged.has("category")) {
    merged.set("category", { taxonomy: "category", termCount: 0, usageCount: 0 });
  }

  const labelRows = await listSettingsByLikePatterns(["taxonomy_label_%"]);
  const labelMap = new Map<string, string>(
    labelRows.map((row) => [row.key.replace(/^taxonomy_label_/, ""), row.value]),
  );

  const taxonomyRows = Array.from(merged.values()).sort((a, b) => a.taxonomy.localeCompare(b.taxonomy));
  const siteLabels = new Map<string, string>(
    await Promise.all(
      taxonomyRows.map(async (row) => [
        row.taxonomy,
        await getSiteTextSetting(normalizedSiteId, `taxonomy_label_${row.taxonomy}`, ""),
      ] as const),
    ),
  );

  return taxonomyRows.map((row) => ({
      ...row,
      label: siteLabels.get(row.taxonomy) ||
        labelMap.get(row.taxonomy) ||
        (row.taxonomy === "category"
          ? "Category"
          : row.taxonomy
              .split(/[_:-]/g)
              .filter(Boolean)
              .map((piece) => piece[0].toUpperCase() + piece.slice(1))
              .join(" ")),
  }));
};

export const setTaxonomyLabel = async (input: { taxonomy: string; label: string; siteId?: string }) => {
  const taxonomy = normalizeTaxonomyKey(input.taxonomy);
  const label = input.label.trim();
  if (!taxonomy || !label) return { error: "taxonomy and label are required" };
  if (!input.siteId) return { error: "Taxonomy labels are site-scoped. Provide siteId." };
  await setSiteTextSetting(input.siteId, `taxonomy_label_${taxonomy}`, label);
  revalidateDomainAndTaxonomyCaches();
  return { ok: true };
};

export const getTaxonomyTerms = async (siteId: string, taxonomy: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  const key = normalizeTaxonomyKey(taxonomy);
  if (!normalizedSiteId || !key) return [];
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
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, key)))
    .orderBy(asc(terms.name));
};

export const getTaxonomyTermsPreview = async (siteId: string, taxonomy: string, limit = 20) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  const key = normalizeTaxonomyKey(taxonomy);
  if (!normalizedSiteId || !key) return [];
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
    .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, key)))
    .orderBy(asc(terms.name))
    .limit(safeLimit);
};

const normalizeTaxonomyMetaKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 80);

export const getTaxonomyTermMeta = async (termTaxonomyId: number) => {
  if (!Number.isFinite(termTaxonomyId) || termTaxonomyId <= 0) return [];
  return db
    .select({
      key: termTaxonomyMeta.key,
      value: termTaxonomyMeta.value,
    })
    .from(termTaxonomyMeta)
    .where(eq(termTaxonomyMeta.termTaxonomyId, Math.trunc(termTaxonomyId)))
    .orderBy(asc(termTaxonomyMeta.key));
};

export const setTaxonomyTermMeta = async (input: {
  termTaxonomyId: number;
  key: string;
  value: string;
}) => {
  const termTaxonomyId = Math.trunc(input.termTaxonomyId);
  const key = normalizeTaxonomyMetaKey(input.key);
  if (!Number.isFinite(termTaxonomyId) || termTaxonomyId <= 0 || !key) {
    return { error: "termTaxonomyId and key are required" };
  }

  await db
    .insert(termTaxonomyMeta)
    .values({
      termTaxonomyId,
      key,
      value: String(input.value ?? ""),
    })
    .onConflictDoUpdate({
      target: [termTaxonomyMeta.termTaxonomyId, termTaxonomyMeta.key],
      set: { value: String(input.value ?? ""), updatedAt: new Date() },
    });

  revalidateDomainAndTaxonomyCaches();
  return { ok: true };
};

export const createTaxonomy = async (input: { siteId: string; taxonomy: string; label?: string; description?: string }) => {
  const siteId = normalizeSiteScope(input.siteId);
  if (!siteId) return { error: "Site id is required" };
  const key = normalizeTaxonomyKey(input.taxonomy);
  if (!key) return { error: "Taxonomy key is required" };
  const label = (input.label?.trim() || key).slice(0, 120);
  return createTaxonomyTerm({
    siteId,
    taxonomy: key,
    label,
    description: input.description,
  });
};

export const renameTaxonomy = async (input: { siteId: string; current: string; next: string }) => {
  const siteId = normalizeSiteScope(input.siteId);
  if (!siteId) return { error: "Site id is required" };
  const current = normalizeTaxonomyKey(input.current);
  const next = normalizeTaxonomyKey(input.next);
  if (!current || !next) return { error: "Current and next taxonomy keys are required" };
  await db
    .update(termTaxonomies)
    .set({ taxonomy: next })
    .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.taxonomy, current)));
  revalidateDomainAndTaxonomyCaches();
  return { ok: true };
};

export const deleteTaxonomy = async (siteId: string, taxonomy: string) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return { error: "Site id is required" };
  const key = normalizeTaxonomyKey(taxonomy);
  if (!key) return { error: "Taxonomy key is required" };

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: termTaxonomies.id, termId: termTaxonomies.termId })
      .from(termTaxonomies)
      .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.taxonomy, key)));
    if (rows.length === 0) return;
    const taxonomyIds = rows.map((row) => row.id);
    await tx.delete(termRelationships).where(inArray(termRelationships.termTaxonomyId, taxonomyIds));
    await tx.delete(termTaxonomyMeta).where(inArray(termTaxonomyMeta.termTaxonomyId, taxonomyIds));
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
  revalidateDomainAndTaxonomyCaches();
  return { ok: true };
};

export const createTaxonomyTerm = async (input: {
  siteId: string;
  taxonomy: string;
  label: string;
  description?: string;
  parentId?: number | null;
}) => {
  const siteId = normalizeSiteScope(input.siteId);
  if (!siteId) return { error: "Site id is required" };
  const taxonomy = normalizeTaxonomyKey(input.taxonomy);
  const label = input.label.trim();
  const parentId = normalizeOptionalParentId(input.parentId);
  if (!taxonomy || !label) {
    return { error: "taxonomy and label are required" };
  }

  if (taxonomy === "category") return createCategoryByName(siteId, label, parentId);
  if (taxonomy === "tag") return createTagByName(siteId, label);

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
      .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.id, parentId), eq(termTaxonomies.taxonomy, taxonomy)))
      .limit(1);
    if (!parent) {
      return { error: "Parent term does not exist in this taxonomy." };
    }
  }

  const [created] = await db
    .insert(termTaxonomies)
    .values({
      siteId,
      termId: term.id,
      taxonomy,
      description: input.description ?? "",
      parentId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    revalidateDomainAndTaxonomyCaches();
    return created;
  }
  const [existing] = await db
    .select()
    .from(termTaxonomies)
    .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.termId, term.id), eq(termTaxonomies.taxonomy, taxonomy)))
    .limit(1);
  if (existing) revalidateDomainAndTaxonomyCaches();
  return existing ?? { error: "Failed to create term taxonomy" };
};

export const updateTaxonomyTerm = async (input: {
  siteId: string;
  termTaxonomyId: number;
  label?: string;
  slug?: string;
  parentId?: number | null;
}) => {
  const siteId = normalizeSiteScope(input.siteId);
  if (!siteId) return { error: "Site id is required" };
  const hasLabel = typeof input.label === "string";
  const hasSlug = typeof input.slug === "string";
  const hasParent = Object.prototype.hasOwnProperty.call(input, "parentId");
  if (!hasLabel && !hasSlug && !hasParent) {
    return { error: "No updates supplied" };
  }

  const [current] = await db
    .select({ termId: termTaxonomies.termId, taxonomy: termTaxonomies.taxonomy })
    .from(termTaxonomies)
    .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.id, input.termTaxonomyId)))
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
      siteId,
      termTaxonomyId: input.termTaxonomyId,
      parentId: nextParentId,
    });
    if ("error" in validation) return validation;

    await db
      .update(termTaxonomies)
      .set({ parentId: nextParentId })
      .where(and(eq(termTaxonomies.siteId, siteId), eq(termTaxonomies.id, input.termTaxonomyId)));
  }
  revalidateDomainAndTaxonomyCaches();
  return { ok: true };
};

export const deleteTaxonomyTerm = async (siteId: string, termTaxonomyId: number) => {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) return { error: "Site id is required" };
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: termTaxonomies.id, termId: termTaxonomies.termId, taxonomy: termTaxonomies.taxonomy })
      .from(termTaxonomies)
      .where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.id, termTaxonomyId)))
      .limit(1);
    if (!current) return;

    await tx
      .update(termTaxonomies)
      .set({ parentId: null })
      .where(
        and(
          eq(termTaxonomies.siteId, normalizedSiteId),
          eq(termTaxonomies.taxonomy, current.taxonomy),
          eq(termTaxonomies.parentId, termTaxonomyId),
        ),
      );

    await tx.delete(termRelationships).where(eq(termRelationships.termTaxonomyId, termTaxonomyId));
    await tx.delete(termTaxonomyMeta).where(eq(termTaxonomyMeta.termTaxonomyId, termTaxonomyId));
    await tx.delete(termTaxonomyDomains).where(eq(termTaxonomyDomains.termTaxonomyId, termTaxonomyId));
    await tx.delete(termTaxonomies).where(and(eq(termTaxonomies.siteId, normalizedSiteId), eq(termTaxonomies.id, termTaxonomyId)));

    const [stillUsed] = await tx
      .select({ id: termTaxonomies.id })
      .from(termTaxonomies)
      .where(eq(termTaxonomies.termId, current.termId))
      .limit(1);
    if (!stillUsed) {
      await tx.delete(terms).where(eq(terms.id, current.termId));
    }
  });
  revalidateDomainAndTaxonomyCaches();
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

    await upsertSiteUserRole(response.id, session.user.id, "administrator");

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
      const companionMediaId = String(formData.get(`${key}__mediaId`) || "").trim();

      // 🔎 Safely pick final URL in priority order: FinalName > Url > undefined
      const finalUrl =
        (typeof maybeFinal === "string" && maybeFinal.length > 0)
          ? maybeFinal
          : (typeof maybeUrl === "string" && maybeUrl.length > 0)
            ? maybeUrl
            : undefined;
      const directUrl = typeof maybeFile === "string" ? maybeFile.trim() : "";
      const resolvedManagedUrl = finalUrl || directUrl || undefined;

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

        } else if (resolvedManagedUrl) {
          // Shared media-manager / URL path
          const blurhash = key === "image"
            ? await getBlurDataURL(resolvedManagedUrl)
            : null;

          response = await db.update(sites)
            .set({
              [key]: resolvedManagedUrl,
              ...(blurhash && { imageBlurhash: blurhash }),
            })
            .where(eq(sites.id, site.id))
            .returning()
            .then((res) => res[0]);

        } else {
          return { error: `No valid file or URL provided for ${key}` };
        }

        await setSiteTextSetting(site.id, `${key}_media_id`, companionMediaId);

        // --- Handle generic string updates ---
      } else {
        const value = maybeFile as string;
        if (key === "subdomain") {
          const nextSubdomain = value.trim().toLowerCase();
          if ((site.subdomain || "").toLowerCase() === "main" && nextSubdomain !== "main") {
            return { error: "The Main Site subdomain must remain 'main'." };
          }
          if ((site.subdomain || "").toLowerCase() !== "main" && nextSubdomain === "main") {
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
  },
  "network.site.manage",
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
  "network.site.delete",
);

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
    if (!domain) {
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
        published: false,
        ...(useRandomDefaultImages ? { image: pickRandomTootyImage() } : {}),
      })
      .returning();

    // Intentionally skip revalidateTag here: this action is invoked from a render-time
    // create-and-redirect page, and Next.js disallows render-phase revalidation calls.

    await emitCmsLifecycleEvent({
      name: "custom_event",
      siteId: site.id,
      payload: {
        event: "content_created",
        contentType: domain.key,
        contentId: response.id,
      },
    });

    return response;
  },
  "site.content.create",
);

export const updateDomainPost = async (
  data: {
    id: string;
    title?: string | null;
    description?: string | null;
    content?: string | null;
    password?: string | null;
    usePassword?: boolean | null;
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

  const mutation = await canUserMutateDomainPost(session.user.id, data.id, "edit");
  const existing = mutation.post;
  if (!existing || !mutation.allowed) {
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
          password: data.password ?? "",
          ...(typeof data.usePassword === "boolean" ? { usePassword: data.usePassword } : {}),
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
        const validTaxonomyIds = (
          await tx
            .select({ id: termTaxonomies.id })
            .from(termTaxonomies)
            .where(and(eq(termTaxonomies.siteId, existing.siteId), inArray(termTaxonomies.id, taxonomyIds)))
        ).map((row) => row.id);
        if (validTaxonomyIds.length !== taxonomyIds.length) {
          throw new Error("One or more taxonomy terms are invalid for this site.");
        }
        await tx.insert(termRelationships).values(
          validTaxonomyIds.map((termTaxonomyId) => ({
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
      .where(and(eq(termRelationships.objectId, data.id), eq(termTaxonomies.siteId, existing.siteId)));

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
    revalidatePublicContentCache();

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

  const mutation = await canUserMutateDomainPost(session.user.id, postId, "edit");
  const post = mutation.post;
  if (!post || !mutation.allowed) {
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
      const nextValue = key === "slug" ? toSeoSlug(value) : value;

      if (key === "published") {
        const canPublish = post.siteId
          ? await userCan("site.content.publish", session.user.id, { siteId: post.siteId })
          : false;
        if (!canPublish) {
          return { error: "Not authorized to change publish status" };
        }
        const nextPublished = value === "true";
        const from = stateFromPublishedFlag(Boolean(post.published));
        const to = stateFromPublishedFlag(nextPublished);
        const canTransition = await canTransitionContentState({
          siteId: post.siteId || null,
          from,
          to,
          contentType: "domain",
          contentId: post.id,
          userId: session.user.id,
        });
        if (!canTransition) {
          return { error: `Transition blocked: ${from} -> ${to}` };
        }
      }

      if (key === "published") {
        const nextPublished = value === "true";
        const result = await setDomainPostPublishedState({
          postId: post.id,
          nextPublished,
          actorType: "admin",
          actorId: session.user.id,
          userId: session.user.id,
        });
        if (!result.ok) {
          return {
            error: result.reason === "transition_blocked"
              ? `Transition blocked: ${result.from} -> ${result.to}`
              : "Failed to update publish status",
          };
        }
        response = result.post;
      } else {
        response = await db
          .update(domainPosts)
          .set({
            [key]: nextValue,
          })
          .where(eq(domainPosts.id, post.id))
          .returning()
          .then((res) => res[0]);
      }
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
    const updatedSlug =
      (typeof response === "object" &&
      response !== null &&
      "slug" in response &&
      typeof (response as { slug?: unknown }).slug === "string")
        ? (response as { slug: string }).slug
        : currentSlug;

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
    revalidatePublicContentCache();

    return response;
  } catch (error: any) {
    return {
      error: error.code === "P2002" ? "This slug is already in use" : error.message,
    };
  }
};

export const deleteDomainPost = async (formData: FormData, postId: string) => {
  const confirmation = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirmation !== "delete") {
    return {
      error: "Type delete to confirm post deletion.",
    };
  }

  const session = await getSession();
  if (!session?.user.id) {
    return { error: "Not authenticated" };
  }

  const mutation = await canUserMutateDomainPost(session.user.id, postId, "delete");
  const post = mutation.post;
  if (!post || !mutation.allowed) {
    return { error: "Post not found" };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(domainPostMeta).where(eq(domainPostMeta.domainPostId, post.id));
      await tx.delete(termRelationships).where(eq(termRelationships.objectId, post.id));
      await tx.delete(domainPosts).where(eq(domainPosts.id, post.id));
    });
    await emitCmsLifecycleEvent({
      name: "content_deleted",
      siteId: post.siteId,
      payload: {
        contentType: "domain",
        contentId: post.id,
      },
    });

    if (post.siteId) {
      const siteRow = await db.query?.sites?.findFirst?.({
        where: eq(sites.id, post.siteId),
        columns: { subdomain: true, customDomain: true },
      });
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
      if (siteRow?.subdomain) {
        const domain = `${siteRow.subdomain}.${rootDomain}`;
        revalidateTag(`${domain}-posts`, "max");
        revalidateTag(`${domain}-${post.slug}`, "max");
      }
      if (siteRow?.customDomain) {
        revalidateTag(`${siteRow.customDomain}-posts`, "max");
        revalidateTag(`${siteRow.customDomain}-${post.slug}`, "max");
      }
    }
    revalidatePublicContentCache();
    return { siteId: post.siteId };
  } catch (error: any) {
    return { error: error.message };
  }
};

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

async function requireAdminSession() {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }
  const allowed = await userCan("network.settings.write", session.user.id);
  if (!allowed) {
    throw new Error("Not authorized");
  }

  return session;
}

async function requireNetworkUsersManageSession() {
  const session = await requireAdminSession();
  const allowed = await userCan("network.users.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
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

function revalidatePublicContentCache() {
  // Frontend routes are path-cached; invalidate all public content surfaces after writes.
  revalidatePath("/[domain]", "layout");
  revalidatePath("/[domain]/[slug]", "page");
  revalidatePath("/[domain]/posts", "page");
  revalidatePath("/[domain]/c/[slug]", "page");
  revalidatePath("/[domain]/t/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
}

function revalidateDomainAndTaxonomyCaches(options?: { siteId?: string | null }) {
  const siteId = String(options?.siteId || "").trim();
  if (siteId) {
    revalidateSettingsPath(`/site/${siteId}/settings/domains`);
    revalidateSettingsPath(`/site/${siteId}/settings/categories`);
  }
  revalidatePath("/site/[id]/settings/domains", "page");
  revalidatePath("/app/site/[id]/settings/domains", "page");
  revalidatePath("/site/[id]/settings/categories", "page");
  revalidatePath("/app/site/[id]/settings/categories", "page");
  revalidateSettingsPath("/settings/sites");
  revalidatePublicContentCache();
}

async function requireOwnedSite(siteIdRaw: string, capability: SiteCapability = "site.settings.write") {
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
  if (!site) {
    return { error: "Not authorized" as const };
  }
  const allowed = await userCan(capability, session.user.id, { siteId: site.id });
  if (!allowed) {
    return { error: "Not authorized" as const };
  }
  return { site };
}

async function listAuthProviderAvailability() {
  const plugins = await listPluginsWithState();
  return plugins
    .filter((plugin) => plugin.capabilities?.authExtensions && plugin.authProviderId)
    .map((plugin) => ({
      id: String(plugin.authProviderId || "").trim(),
      key: `plugin_${plugin.id}_enabled`,
      enabled: Boolean(plugin.enabled),
      pluginId: plugin.id,
    }))
    .filter((provider) => provider.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeProfileSectionRows(input: unknown): ProfileSectionRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const label = String((row as any).label || "").trim();
      const value = String((row as any).value || "").trim();
      if (!label || !value) return null;
      return { label, value };
    })
    .filter(Boolean) as ProfileSectionRow[];
}

function normalizeProfileSections(input: unknown): ProfileSection[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((section) => {
      if (!section || typeof section !== "object") return null;
      const id = String((section as any).id || "").trim();
      const title = String((section as any).title || "").trim();
      if (!id || !title) return null;
      const descriptionRaw = String((section as any).description || "").trim();
      return {
        id,
        title,
        description: descriptionRaw || undefined,
        rows: normalizeProfileSectionRows((section as any).rows),
      };
    })
    .filter(Boolean) as ProfileSection[];
}

function parseJsonObject(raw: string | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

async function getEnabledConfiguredOauthProviders() {
  const providers = await listAuthProviderAvailability();
  const enabledProviders = providers.filter((provider) => provider.enabled);
  if (enabledProviders.length === 0) return [];

  const configKeys = enabledProviders.map((provider) => `plugin_${provider.pluginId}_config`);
  const byKey = await getSettingsByKeys(configKeys);

  return enabledProviders
    .filter((provider) => {
      const config = parseJsonObject(byKey[`plugin_${provider.pluginId}_config`]);
      const values = Object.values(config)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      return values.length > 0;
    })
    .map((provider) => provider.id);
}

async function withUserAuthState<T extends { id: string; passwordHash: string | null }>(rows: T[]) {
  if (rows.length === 0) return [] as Array<Omit<T, "passwordHash"> & { forcePasswordChange: boolean; authProviders: string[] }>;
  const userIds = rows.map((row) => row.id);
  const enabledOauthProviders = await getEnabledConfiguredOauthProviders();
  const linkedAccounts = await db
    .select({
      userId: accounts.userId,
      provider: accounts.provider,
    })
    .from(accounts)
    .where(inArray(accounts.userId, userIds));
  const linkedByUser = new Map<string, Set<string>>();
  for (const account of linkedAccounts) {
    if (!linkedByUser.has(account.userId)) linkedByUser.set(account.userId, new Set());
    linkedByUser.get(account.userId)!.add(String(account.provider || "").trim());
  }

  return Promise.all(
    rows.map(async (row) => {
      const linked = linkedByUser.get(row.id) ?? new Set<string>();
      const authProviders: string[] = [];
      if (row.passwordHash) authProviders.push("native");
      for (const provider of enabledOauthProviders) {
        if (linked.has(provider)) authProviders.push(provider);
      }
      const { passwordHash: _passwordHash, ...rest } = row;
      return {
        ...rest,
        authProviders,
        forcePasswordChange: (await getUserMetaValue(row.id, "force_password_change")) === "true",
      };
    }),
  );
}

async function getOauthProviderSettingsInternal() {
  return listAuthProviderAvailability();
}

export const getProfile = async (siteId?: string) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const self = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!self) {
    throw new Error("User not found");
  }

  const providerFlags = await getOauthProviderSettingsInternal();
  const linkedAccounts = await db.query.accounts.findMany({
    where: eq(accounts.userId, self.id),
    columns: { provider: true },
  });
  const linkedSet = new Set(linkedAccounts.map((account) => String(account.provider || "").trim()).filter(Boolean));
  const forcePasswordChange = (await getUserMetaValue(self.id, "force_password_change")) === "true";
  const displayName = (await getUserMetaValue(self.id, "display_name")) || self.name || "";
  const kernel = await createKernelForRequest(siteId);
  const extensionSectionsRaw = await kernel.applyFilters<ProfileSection[]>("admin:profile:sections", [], {
    siteId: siteId || null,
    userId: self.id,
    role: self.role,
  });

  return {
    user: {
      id: self.id,
      name: self.name ?? "",
      displayName,
      email: self.email,
      role: self.role,
      hasNativePassword: Boolean(self.passwordHash),
      forcePasswordChange,
      createdAt: self.createdAt,
      updatedAt: self.updatedAt,
    },
    authProviders: {
      available: providerFlags.map((provider) => ({
        id: provider.id,
        enabled: provider.enabled,
        linked: linkedSet.has(provider.id),
      })),
      native: {
        enabled: true,
        linked: Boolean(self.passwordHash),
      },
    },
    extensionSections: normalizeProfileSections(extensionSectionsRaw),
  };
};

export const updateProfile = async (formData: FormData) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const name = normalizeOptionalString(formData.get("name"));
  const displayName = normalizeOptionalString(formData.get("displayName")) || "";
  const emailRaw = formData.get("email");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!email || !validateEmail(email)) {
    return { error: "Valid email is required" };
  }

  try {
    await db
      .update(users)
      .set({
        name,
        email,
      })
      .where(eq(users.id, session.user.id));
    await setUserMetaValue(session.user.id, "display_name", displayName);
  } catch (error: any) {
    if (error?.code === "23505") {
      return { error: "Another account already uses that email" };
    }
    return { error: error?.message || "Failed to update profile" };
  }

  revalidateSettingsPath("/settings/profile");
  return { ok: true };
};

export const updateOwnPassword = async (formData: FormData) => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirmPassword") || "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match" };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, session.user.id));
  await setUserMetaValue(session.user.id, "force_password_change", "false");

  revalidateSettingsPath("/settings/profile");
  return { ok: true };
};

export const getGlobalRbacSettingsAdmin = async () => {
  const session = await requireAdminSession();
  const allowed = await userCan("network.rbac.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
  const roles = await listRbacRoles();
  const roleIds = roles.map((row) => row.role);
  return {
    roles: roleIds.length > 0 ? roleIds : [...USER_ROLES],
    systemRoles: [...SYSTEM_ROLES],
    capabilities: SITE_CAPABILITIES,
    matrix: await getCapabilityMatrix(),
  };
};

export const updateGlobalRbacSettings = async (formData: FormData) => {
  const session = await requireAdminSession();
  const allowed = await userCan("network.rbac.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
  const selectedRole = normalizeOptionalString(formData.get("selectedRole"));
  if (!selectedRole) return;
  const next = Object.fromEntries(
    SITE_CAPABILITIES.map((capability) => {
      const key = `cap__${selectedRole}__${capability}`;
      return [capability, formData.get(key) === "on"];
    }),
  );
  await saveRoleCapabilities(selectedRole, next);
  revalidateSettingsPath("/settings/rbac");
};

export const updateGlobalRbacCapability = async (formData: FormData) => {
  const session = await requireAdminSession();
  const allowed = await userCan("network.rbac.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
  const selectedRole = normalizeOptionalString(formData.get("selectedRole"));
  const capabilityRaw = normalizeOptionalString(formData.get("capability")) as typeof SITE_CAPABILITIES[number] | null;
  const enabled = formData.get("enabled") === "on";
  if (!selectedRole || !capabilityRaw || !SITE_CAPABILITIES.includes(capabilityRaw)) return;

  const matrix = await getCapabilityMatrix();
  const current = matrix[selectedRole] || Object.fromEntries(SITE_CAPABILITIES.map((capability) => [capability, false]));
  const next = { ...current, [capabilityRaw]: enabled };
  await saveRoleCapabilities(selectedRole, next);
  revalidateSettingsPath("/settings/rbac");
};

export const createGlobalRbacRole = async (formData: FormData) => {
  const session = await requireAdminSession();
  const allowed = await userCan("network.rbac.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
  const roleRaw = normalizeOptionalString(formData.get("role"));
  if (!roleRaw) return;
  const normalized = roleRaw.toLowerCase();
  const existing = await listRbacRoles();
  const exists = existing.some((row) => row.role === normalized);
  const confirmCreate = String(formData.get("confirmCreate") || "").trim().toLowerCase();
  if (!exists && confirmCreate !== "create") {
    throw new Error('Role creation requires confirmation: type "create".');
  }
  await createRbacRole(roleRaw);
  revalidateSettingsPath("/settings/rbac");
};

export const deleteGlobalRbacRole = async (formData: FormData) => {
  const session = await requireAdminSession();
  const allowed = await userCan("network.rbac.manage", session.user.id);
  if (!allowed) throw new Error("Not authorized");
  const roleRaw = normalizeOptionalString(formData.get("role"));
  if (!roleRaw) return;
  const confirmDelete = String(formData.get("confirmDelete") || "").trim().toLowerCase();
  if (confirmDelete !== "delete") {
    throw new Error('Role delete requires confirmation: type "delete".');
  }
  await deleteRbacRole(roleRaw);
  revalidateSettingsPath("/settings/rbac");
};

export const listUsersAdmin = async () => {
  const session = await requireNetworkUsersManageSession();

  const allSites = await db.query.sites.findMany({
    columns: { id: true },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });

  if (allSites.length === 1) {
    const siteId = allSites[0].id;
    const siteUsers = await listSiteUsers(siteId);
    const ids = Array.from(new Set(siteUsers.map((entry) => entry.user_id))).filter(Boolean);
    if (ids.length === 0) return [];

    const globalUsers = await db.query.users.findMany({
      where: inArray(users.id, ids),
      columns: {
        id: true,
        name: true,
        username: true,
        email: true,
        image: true,
        passwordHash: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const globalById = new Map(globalUsers.map((entry) => [entry.id, entry]));

    const scopedUsers = siteUsers
      .map((entry) => {
        const global = globalById.get(entry.user_id);
        if (!global) return null;
        return {
          ...global,
          role: entry.role || global.role,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string | null;
      username: string | null;
      email: string;
      image: string | null;
      passwordHash: string | null;
      role: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
    return withUserAuthState(scopedUsers);
  }

  const networkUsers = await db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      username: true,
      email: true,
      image: true,
      passwordHash: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: (users, { asc }) => [asc(users.createdAt)],
  });
  return withUserAuthState(networkUsers);
};

export const createUserAdmin = async (formData: FormData) => {
  await requireNetworkUsersManageSession();

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
  const availableRoles = await listRbacRoles();
  const allowedRoleSet = new Set(availableRoles.map((row) => row.role));
  const role = roleRaw && allowedRoleSet.has(roleRaw) ? roleRaw : "author";
  const password = String(formData.get("password") || "");
  const passwordHash = password.length >= 8 ? await hashPassword(password) : null;

  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name,
        username,
        gh_username: ghUsername,
        image,
        passwordHash,
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
  await requireNetworkUsersManageSession();

  const id = normalizeOptionalString(formData.get("id"));
  if (!id) return { error: "Missing user id" };

  const emailRaw = formData.get("email");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!email || !validateEmail(email)) {
    return { error: "Valid email is required" };
  }

  const name = normalizeOptionalString(formData.get("name"));
  const username = normalizeOptionalString(formData.get("username"));
  const ghRaw = formData.get("gh_username");
  const ghUsername = ghRaw === null ? undefined : normalizeOptionalString(ghRaw);
  const image = normalizeOptionalString(formData.get("image"));
  const roleRaw = normalizeOptionalString(formData.get("role"));
  const availableRoles = await listRbacRoles();
  const allowedRoleSet = new Set(availableRoles.map((row) => row.role));
  if (!roleRaw || !allowedRoleSet.has(roleRaw)) {
    return { error: "Valid role is required" };
  }
  const password = String(formData.get("password") || "");
  const forcePasswordChange = formData.get("force_password_change") === "on";
  const nextPasswordHash = password.length >= 8 ? await hashPassword(password) : null;
  const updateValues: Record<string, unknown> = {
    email,
    name,
    username,
    image,
    role: roleRaw,
  };
  if (ghUsername !== undefined) {
    updateValues.gh_username = ghUsername;
  }
  if (nextPasswordHash) {
    updateValues.passwordHash = nextPasswordHash;
  }

  try {
    const [updated] = await db
      .update(users)
      .set(updateValues)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!updated) return { error: "User not found" };

    if (nextPasswordHash) {
      await setUserMetaValue(id, "force_password_change", forcePasswordChange ? "true" : "false");
    }

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
  const session = await requireNetworkUsersManageSession();

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

function mimicCookieOptions() {
  const secure = Boolean(process.env.VERCEL_URL);
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
}

export const startUserMimicAdmin = async (formData: FormData) => {
  const session = await requireNetworkUsersManageSession();
  const targetId = normalizeOptionalString(formData.get("targetUserId"));
  if (!targetId) return { error: "Missing target user id" };
  if (targetId === session.user.id) return { ok: true };

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true, role: true },
  });
  if (!target) return { error: "Target user not found" };

  const store = await cookies();
  store.set(MIMIC_ACTOR_COOKIE, session.user.id, mimicCookieOptions());
  store.set(MIMIC_TARGET_COOKIE, targetId, mimicCookieOptions());
  revalidatePath("/app", "layout");
  return { ok: true };
};

export const stopUserMimic = async () => {
  const session = await getSession();
  if (!session?.user?.id) return { error: "Not authenticated" };

  const store = await cookies();
  const actorId = String(store.get(MIMIC_ACTOR_COOKIE)?.value || "").trim();
  const mimicActorId = String((session.user as any).mimicActorId || "").trim();
  if (!actorId || (actorId !== mimicActorId && actorId !== session.user.id)) {
    return { error: "No active mimic session" };
  }

  store.delete(MIMIC_ACTOR_COOKIE);
  store.delete(MIMIC_TARGET_COOKIE);
  revalidatePath("/app", "layout");
  return { ok: true };
};

export const listOauthProviderSettings = async () => {
  await requireAdminSession();
  return getOauthProviderSettingsInternal();
};

export const updateOauthProviderSettings = async (formData: FormData) => {
  await requireAdminSession();
  const providers = await listAuthProviderAvailability();
  for (const provider of providers) {
    const key = `plugin_${provider.pluginId}_enabled`;
    const enabled = formData.get(`oauth_provider_${provider.id}`) === "on";
    await setSettingByKey(key, enabled ? "true" : "false");
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
      slug: domainPosts.slug,
      subdomain: sites.subdomain,
      customDomain: sites.customDomain,
    })
    .from(domainPosts)
    .leftJoin(sites, eq(domainPosts.siteId, sites.id));

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
  revalidatePublicContentCache();
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
  const owned = await requireOwnedSite(siteIdRaw, "site.settings.write");
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
  const reservedAdminAlias = getAdminPathAlias();

  if (noDomainPrefix === "app") {
    return { error: "The `app` path is reserved for the admin system." };
  }
  if (noDomainPrefix === reservedAdminAlias) {
    return { error: `The \`${reservedAdminAlias}\` path is reserved for the admin system.` };
  }

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
  revalidatePublicContentCache();
  return { ok: true };
};

export const getSiteSeoSettingsAdmin = async (siteIdRaw: string) => {
  const owned = await requireOwnedSite(siteIdRaw, "site.seo.manage");
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const [
    indexingEnabled,
    seoMetaTitle,
    seoMetaDescription,
    socialMetaTitle,
    socialMetaDescription,
    socialMetaImage,
    socialMetaImageMediaId,
  ] =
    await Promise.all([
      getSiteBooleanSetting(site.id, SEO_INDEXING_ENABLED_KEY, true),
      getSiteTextSetting(site.id, SEO_META_TITLE_KEY, ""),
      getSiteTextSetting(site.id, SEO_META_DESCRIPTION_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_TITLE_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_DESCRIPTION_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_IMAGE_KEY, ""),
      getSiteTextSetting(site.id, SOCIAL_META_IMAGE_MEDIA_ID_KEY, ""),
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
    socialMetaImageMediaId,
  };
};

export const updateSiteSeoSettings = async (formData: FormData) => {
  const siteIdRaw = (formData.get("siteId") as string | null) ?? "";
  const owned = await requireOwnedSite(siteIdRaw, "site.seo.manage");
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const indexingEnabled = formData.get("seo_indexing_enabled") === "on";
  const seoMetaTitle = ((formData.get("seo_meta_title") as string | null) ?? "").trim();
  const seoMetaDescription = ((formData.get("seo_meta_description") as string | null) ?? "").trim();
  const socialMetaTitle = ((formData.get("social_meta_title") as string | null) ?? "").trim();
  const socialMetaDescription = ((formData.get("social_meta_description") as string | null) ?? "").trim();
  const socialMetaImage = ((formData.get("social_meta_image") as string | null) ?? "").trim();
  const socialMetaImageMediaId = ((formData.get("social_meta_image__mediaId") as string | null) ?? "").trim();

  await Promise.all([
    setSiteBooleanSetting(site.id, SEO_INDEXING_ENABLED_KEY, indexingEnabled),
    setSiteTextSetting(site.id, SEO_META_TITLE_KEY, seoMetaTitle),
    setSiteTextSetting(site.id, SEO_META_DESCRIPTION_KEY, seoMetaDescription),
    setSiteTextSetting(site.id, SOCIAL_META_TITLE_KEY, socialMetaTitle),
    setSiteTextSetting(site.id, SOCIAL_META_DESCRIPTION_KEY, socialMetaDescription),
    setSiteTextSetting(site.id, SOCIAL_META_IMAGE_KEY, socialMetaImage),
    setSiteTextSetting(site.id, SOCIAL_META_IMAGE_MEDIA_ID_KEY, socialMetaImageMediaId),
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
  const commentsPluginEnabled = await hasEnabledCommentProvider(site.id);
  const effectiveEnableComments = commentsPluginEnabled ? writing.enableComments : false;
  const commentWritingOptions = commentsPluginEnabled ? await getCommentProviderWritingOptions(site.id) : [];
  return {
    siteId: site.id,
    editorMode: writing.editorMode,
    defaultEnableComments: effectiveEnableComments,
    commentsPluginEnabled,
    commentWritingOptions,
  };
};

export const updateSiteEditorSettings = async (formData: FormData) => {
  const siteIdRaw = (formData.get("siteId") as string | null) ?? "";
  const owned = await requireOwnedSite(siteIdRaw, "site.settings.write");
  if ("error" in owned) return { error: owned.error };
  const { site } = owned;

  const editorMode = ((formData.get("writing_editor_mode") as string | null) ?? "rich-text").trim() || "rich-text";
  const enableComments = formData.get("writing_enable_comments") === "on";
  const commentsPluginEnabled = await hasEnabledCommentProvider(site.id);
  const commentWritingOptions = commentsPluginEnabled ? await getCommentProviderWritingOptions(site.id) : [];

  const updates: Array<Promise<unknown>> = [
    setSiteTextSetting(site.id, WRITING_EDITOR_MODE_KEY, editorMode),
    setSiteBooleanSetting(site.id, WRITING_ENABLE_COMMENTS_KEY, commentsPluginEnabled ? enableComments : false),
  ];
  for (const option of commentWritingOptions) {
    const checked = formData.get(option.formField) === "on";
    updates.push(setSiteBooleanSetting(site.id, option.settingKey, checked));
  }
  await Promise.all(updates);

  revalidatePath(`/site/${site.id}/settings/writing`);
  revalidatePath(`/app/site/${site.id}/settings/writing`);
  return { ok: true };
};

export type ScheduleActionOption = {
  key: string;
  label: string;
  description?: string;
};

function normalizeScheduleActionOptions(input: unknown): ScheduleActionOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const key = String((row as any).key || "").trim();
      const label = String((row as any).label || "").trim();
      const descriptionRaw = String((row as any).description || "").trim();
      if (!key || !label) return null;
      return {
        key,
        label,
        description: descriptionRaw || undefined,
      };
    })
    .filter(Boolean) as ScheduleActionOption[];
}

async function getScheduleActionCatalog(): Promise<ScheduleActionOption[]> {
  const core: ScheduleActionOption[] = [
    {
      key: "core.ping_sitemap",
      label: "Ping Sitemap",
      description: "Fetches /sitemap.xml for configured site URL.",
    },
    {
      key: "core.http_ping",
      label: "HTTP Ping",
      description: "Requests payload.url with payload.method (default GET).",
    },
    {
      key: "core.communication.retry",
      label: "Retry Communication Queue",
      description: "Retries pending outbound communication records.",
    },
    {
      key: "core.communication.purge",
      label: "Purge Communication Queue",
      description: "Deletes old communication audit/queue rows.",
    },
    {
      key: "core.webcallbacks.purge",
      label: "Purge Webcallbacks",
      description: "Deletes old webcallback delivery/audit rows.",
    },
    {
      key: "core.webhooks.retry",
      label: "Retry Webhook Deliveries",
      description: "Retries queued/retrying outbound webhook deliveries.",
    },
    {
      key: "core.media.cleanup",
      label: "Cleanup Media Records",
      description: "Deletes media index rows older than payload.olderThanDays (default 30).",
    },
    {
      key: "core.content.publish",
      label: "Publish Content",
      description: "Publishes a domain content record from payload.domainPostId.",
    },
    {
      key: "core.content.unpublish",
      label: "Unpublish Content",
      description: "Unpublishes a domain content record from payload.domainPostId.",
    },
  ];

  try {
    const kernel = await createKernelForRequest(undefined);
    const filtered = await kernel.applyFilters<ScheduleActionOption[]>("admin:schedule-actions", core, {
      scope: "global",
    });
    const normalized = normalizeScheduleActionOptions(filtered);
    if (normalized.length === 0) return core;
    const deduped = new Map<string, ScheduleActionOption>();
    for (const item of normalized) deduped.set(item.key, item);
    return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return core;
  }
}

export const getScheduleSettingsAdmin = async () => {
  await requireAdminSession();
  const [settings, schedules, allSites, actionOptions] = await Promise.all([
    getScheduleSettings(),
    listScheduleEntries({ includeDisabled: true }),
    db.query.sites.findMany({
      columns: { id: true, name: true, subdomain: true, customDomain: true, isPrimary: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    }),
    getScheduleActionCatalog(),
  ]);

  const runAuditsBySchedule = new Map(
    await Promise.all(
      schedules.map(async (entry: ScheduleEntry) => [entry.id, await listScheduleRunAudits(entry.id, 10)] as const),
    ),
  );

  const siteById = new Map(allSites.map((site) => [site.id, site]));
  const rows = schedules.map((entry: ScheduleEntry) => ({
    ...entry,
    runAudits: runAuditsBySchedule.get(entry.id) ?? [],
    site:
      entry.siteId && siteById.has(entry.siteId)
        ? siteById.get(entry.siteId)
        : null,
  }));

  return {
    ...settings,
    schedules: rows,
    sites: allSites,
    actionOptions,
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
  const maxRetries = Number(formData.get("maxRetries") || "3");
  const backoffBaseSeconds = Number(formData.get("backoffBaseSeconds") || "60");
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
    maxRetries,
    backoffBaseSeconds,
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
  const maxRetries = Number(formData.get("maxRetries") || "3");
  const backoffBaseSeconds = Number(formData.get("backoffBaseSeconds") || "60");
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
      maxRetries,
      backoffBaseSeconds,
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

export const runScheduledActionNowAdmin = async (formData: FormData) => {
  await requireAdminSession();
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing schedule id");

  const gotLock = await acquireSchedulerLock();
  if (!gotLock) throw new Error("Scheduler runner lock busy. Try again.");

  try {
    await runScheduleEntryNow(id);
  } finally {
    await releaseSchedulerLock();
  }

  revalidateSettingsPath("/settings/schedules");
};
