import { and, eq, inArray, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { revalidatePath, revalidateTag } from "next/cache";

import { canUserMutateDomainPost, userCan } from "@/lib/authorization";
import db from "@/lib/db";
import { DEFAULT_CORE_DOMAIN_KEYS, ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import { emitDomainEvent } from "@/lib/domain-dispatch";
import { findSiteDataDomainByKeyWithConsistency } from "@/lib/site-data-domain-consistency";
import { MAX_SEO_SLUG_LENGTH, normalizeSeoSlug } from "@/lib/slug";
import { sites } from "@/lib/schema";
import {
  createSiteDomainPost as createSiteScopedDomainPost,
  getSiteDomainPostById,
  listSiteDomainPostMeta,
  replaceSiteDomainPostMeta,
  updateSiteDomainPostById,
} from "@/lib/site-domain-post-store";
import {
  ensureSiteTaxonomyTables,
  getSiteTaxonomyTables,
  resetSiteTaxonomyTablesCache,
  withSiteTaxonomyTableRecovery,
} from "@/lib/site-taxonomy-tables";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  listScheduleEntries,
  type ScheduleEntry,
  updateScheduleEntry,
} from "@/lib/scheduler";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7,
);

const CORE_CONTENT_PUBLISH_ACTION_KEY = "core.content.publish";

export const HIDDEN_PUBLISH_AT_META_KEY = "_publish_at";

export type DomainPostUpdateInput = {
  id: string;
  siteId?: string | null;
  dataDomainKey?: string | null;
  title?: string | null;
  description?: string | null;
  slug?: string;
  content?: string | null;
  password?: string | null;
  usePassword?: boolean | null;
  layout?: string | null;
  categoryIds?: Array<number | string>;
  tagIds?: Array<number | string>;
  taxonomyIds?: Array<number | string>;
  selectedTermsByTaxonomy?: Record<string, Array<number | string>>;
  metaEntries?: Array<{ key: string; value: string }>;
};

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

function contentPublishScheduleOwnerId(postId: string) {
  return `domain-post:${String(postId || "").trim()}`;
}

export function normalizeScheduledPublishAt(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return { ok: true as const, value: null as string | null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false as const, error: "Invalid scheduled publish date." };
  }
  return { ok: true as const, value: parsed.toISOString() };
}

async function findContentPublishScheduleForPost(postId: string) {
  const ownerId = contentPublishScheduleOwnerId(postId);
  const entries = await listScheduleEntries({
    ownerType: "core",
    ownerId,
    includeDisabled: true,
  });
  return entries.find((entry: ScheduleEntry) => entry.actionKey === CORE_CONTENT_PUBLISH_ACTION_KEY) || null;
}

export async function syncContentPublishScheduleForPost(input: {
  post: {
    id: string;
    siteId?: string | null;
    title?: string | null;
    slug?: string | null;
  } | null;
  publishAt: string | null;
  createIfMissing: boolean;
}) {
  const post = input.post;
  if (!post) return null;
  const existing = await findContentPublishScheduleForPost(post.id);
  if (!input.publishAt) {
    if (existing) {
      await deleteScheduleEntry(existing.id, { isAdmin: true });
    }
    return null;
  }

  const nextRunAt = new Date(input.publishAt);
  if (Number.isNaN(nextRunAt.getTime()) || nextRunAt.getTime() <= Date.now()) {
    if (existing) {
      await deleteScheduleEntry(existing.id, { isAdmin: true });
    }
    return null;
  }

  const name = `Publish ${String(post.title || post.slug || post.id).trim()}`;
  const payload = {
    domainPostId: post.id,
    contentId: post.id,
    siteId: post.siteId,
    runOnce: true,
  };

  if (existing) {
    return updateScheduleEntry(
      existing.id,
      {
        siteId: post.siteId || null,
        name,
        actionKey: CORE_CONTENT_PUBLISH_ACTION_KEY,
        payload,
        enabled: true,
        nextRunAt,
      },
      { isAdmin: true },
    );
  }

  if (!input.createIfMissing) return null;

  return createScheduleEntry("core", contentPublishScheduleOwnerId(post.id), {
    siteId: post.siteId || null,
    name,
    actionKey: CORE_CONTENT_PUBLISH_ACTION_KEY,
    payload,
    enabled: true,
    nextRunAt,
  });
}

const normalizeSiteScope = (siteId: string) => String(siteId || "").trim();

async function resolveSiteTaxonomyTables(siteId: string) {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  await ensureSiteTaxonomyTables(normalizedSiteId);
  return getSiteTaxonomyTables(normalizedSiteId);
}

async function withResolvedSiteTaxonomyTables<T>(
  siteId: string,
  run: (tables: Awaited<ReturnType<typeof resolveSiteTaxonomyTables>>) => Promise<T>,
) {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  return withSiteTaxonomyTableRecovery(normalizedSiteId, async () => {
    const tables = await resolveSiteTaxonomyTables(normalizedSiteId);
    return run(tables);
  });
}

function isRetryableSiteTaxonomyForeignKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; detail?: string; table?: string; message?: string };
  if (candidate.code !== "23503") return false;
  const table = String(candidate.table || "");
  const detail = String(candidate.detail || "");
  const message = String(candidate.message || "");
  return table.includes("_term_tax") && (detail.includes("_terms") || message.includes("_terms"));
}

function isRetryableSiteWriteLockError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "40P01" || candidate.code === "55P03";
}

async function withRetryableSiteWrite<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableSiteWriteLockError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

async function getSiteDomainPostByIdWithRetry(
  input: { siteId: string; postId: string; dataDomainKey?: string },
  attempts = 24,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const record = await getSiteDomainPostById(input);
    if (record || attempt === attempts) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(150 * attempt, 1_500)));
  }
  return null;
}

async function resolveValidSiteTaxonomyIdsWithRetry(
  siteId: string,
  requestedTaxonomyIds: number[],
  attempts = 6,
) {
  let validTaxonomyIds: number[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    validTaxonomyIds = Array.from(
      new Set(
        (
          await withResolvedSiteTaxonomyTables(siteId, async ({ termTaxonomiesTable }) =>
            db
              .select({ id: termTaxonomiesTable.id })
              .from(termTaxonomiesTable)
              .where(inArray(termTaxonomiesTable.id, requestedTaxonomyIds)),
          )
        ).map((row) => row.id),
      ),
    );
    if (validTaxonomyIds.length === requestedTaxonomyIds.length || attempt === attempts) {
      return validTaxonomyIds;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(200 * attempt, 1_250)));
  }
  return validTaxonomyIds;
}

async function withTaxonomyWriteRecovery<T>(siteId: string, run: () => Promise<T>): Promise<T> {
  const normalizedSiteId = normalizeSiteScope(siteId);
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  try {
    return await run();
  } catch (error) {
    if (!isRetryableSiteTaxonomyForeignKeyError(error)) {
      throw error;
    }
    resetSiteTaxonomyTablesCache(normalizedSiteId);
    await ensureSiteTaxonomyTables(normalizedSiteId);
    return run();
  }
}

async function getSiteDataDomainByKey(siteId: string, domainKey: string) {
  const row = await findSiteDataDomainByKeyWithConsistency(siteId, domainKey);
  if (!row) return null;
  if (DEFAULT_CORE_DOMAIN_KEYS.includes(row.key as (typeof DEFAULT_CORE_DOMAIN_KEYS)[number])) {
    return { ...row, isActive: true };
  }
  return row;
}

function toSeoSlug(input: string) {
  const normalized = normalizeSeoSlug(input).slice(0, MAX_SEO_SLUG_LENGTH);
  return normalized || `post-${nanoid().toLowerCase()}`;
}

function revalidatePublicContentCache() {
  revalidatePath("/[domain]", "layout");
  revalidatePath("/[domain]/[slug]", "page");
  revalidatePath("/[domain]/[slug]/[child]", "page");
  revalidatePath("/[domain]/posts", "page");
  revalidatePath("/[domain]/c/[slug]", "page");
  revalidatePath("/[domain]/t/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/robots.txt");
}

export async function persistDomainPostUpdateForUser(input: {
  userId: string;
  data: DomainPostUpdateInput;
}) {
  const { userId, data } = input;

  const requestedSiteId = normalizeSiteScope(String(data.siteId || ""));
  const requestedDomainKey = String(data.dataDomainKey || "")
    .trim()
    .toLowerCase();
  const mutation = await canUserMutateDomainPost(
    userId,
    data.id,
    "edit",
    requestedSiteId || null,
  );
  const existingPost = mutation.post;
  const existing =
    existingPost ||
    (requestedSiteId && requestedDomainKey
      ? {
          id: data.id,
          siteId: requestedSiteId,
          dataDomainKey: requestedDomainKey,
          slug: "",
        }
      : null);
  if (!existing) {
    return { error: "Post not found or not authorized" };
  }

  const canCreatePlaceholder =
    !existingPost &&
    requestedSiteId.length > 0 &&
    requestedDomainKey.length > 0 &&
    (await userCan("site.content.create", userId, { siteId: requestedSiteId }));

  if (!mutation.allowed && !canCreatePlaceholder) {
    return { error: "Post not found or not authorized" };
  }

  try {
    let createdFresh = false;
    const normalizeTaxonomyIds = (...sources: Array<Array<number | string> | undefined>) =>
      Array.from(
        new Set(
          sources
            .flatMap((source) => source ?? [])
            .map((value) => (typeof value === "number" ? value : Number(String(value).trim())))
            .filter((value): value is number => Number.isFinite(value)),
        ),
      );

    const requestedTaxonomyIds = Array.from(
      new Set(
        normalizeTaxonomyIds(
          Array.isArray(data.taxonomyIds) ? data.taxonomyIds : undefined,
          Array.isArray(data.categoryIds) ? data.categoryIds : undefined,
          Array.isArray(data.tagIds) ? data.tagIds : undefined,
          ...Object.values(data.selectedTermsByTaxonomy ?? {}),
        ),
      ),
    );

    const validRequestedTaxonomyIds =
      requestedTaxonomyIds.length > 0
        ? await resolveValidSiteTaxonomyIdsWithRetry(existing.siteId, requestedTaxonomyIds)
        : [];
    if (requestedTaxonomyIds.length > 0 && validRequestedTaxonomyIds.length !== requestedTaxonomyIds.length) {
      return { error: "One or more taxonomy terms are invalid for this site." };
    }

    const rawSlugInput = typeof data.slug === "string" ? data.slug.trim() : "";
    const normalizedSlugInput = rawSlugInput ? toSeoSlug(rawSlugInput) : "";
    const fallbackCreateSlug =
      normalizedSlugInput ||
      toSeoSlug(String(data.title || "").trim()) ||
      toSeoSlug(`${existing.dataDomainKey}-${data.id}`) ||
      `${existing.dataDomainKey}-${data.id}`;
    const updatePatch = {
      title: data.title,
      description: data.description,
      ...(rawSlugInput ? { slug: normalizedSlugInput } : {}),
      content: data.content,
      password: data.password ?? "",
      ...(typeof data.usePassword === "boolean" ? { usePassword: data.usePassword } : {}),
      layout: data.layout ?? null,
    };
    const recoveryPatch = {
      ...updatePatch,
      slug: rawSlugInput ? normalizedSlugInput : fallbackCreateSlug,
    };

    let postRecord = null;
    if (existingPost) {
      postRecord = await updateSiteDomainPostById({
        siteId: existing.siteId,
        postId: data.id,
        dataDomainKey: existing.dataDomainKey,
        patch: updatePatch,
      });
    } else {
      const domain = await getSiteDataDomainByKey(existing.siteId, existing.dataDomainKey);
      if (!domain) {
        return { error: "Data domain not found for site." };
      }
      try {
        postRecord = await createSiteScopedDomainPost({
          siteId: existing.siteId,
          userId,
          dataDomainId: domain.id,
          dataDomainKey: domain.key,
          id: data.id,
          title: data.title ?? "",
          description: data.description ?? "",
          content: data.content ?? "",
          password: data.password ?? "",
          usePassword: typeof data.usePassword === "boolean" ? data.usePassword : false,
          layout: data.layout ?? null,
          slug: fallbackCreateSlug,
          published: false,
        });
        createdFresh = true;
      } catch (error: any) {
        if (error?.code !== "23505") throw error;
        postRecord = await getSiteDomainPostByIdWithRetry({
          siteId: existing.siteId,
          postId: data.id,
          dataDomainKey: existing.dataDomainKey,
        });
        if (postRecord) {
          postRecord = await updateSiteDomainPostById({
            siteId: existing.siteId,
            postId: data.id,
            dataDomainKey: existing.dataDomainKey,
            patch: recoveryPatch,
          });
        }
      }
    }
    if (!postRecord) {
      return { error: "Post not found or not authorized" };
    }

    await withRetryableSiteWrite(() =>
      withResolvedSiteTaxonomyTables(existing.siteId, async ({ termRelationshipsTable }) => {
        await db.transaction(async (tx) => {
          const advisoryKey = `${existing.siteId}:domain-post-taxonomies`;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
          await tx.delete(termRelationshipsTable).where(eq(termRelationshipsTable.objectId, data.id));
          if (validRequestedTaxonomyIds.length > 0) {
            await tx
              .insert(termRelationshipsTable)
              .values(
                validRequestedTaxonomyIds.map((termTaxonomyId) => ({
                  objectId: data.id,
                  termTaxonomyId,
                })),
              )
              .onConflictDoNothing();
          }
        });
      }),
    );

    if (Array.isArray(data.metaEntries)) {
      const normalizedMeta = data.metaEntries
        .map((entry) => ({
          key: entry.key.trim(),
          value: entry.value.trim(),
        }))
        .filter((entry) => entry.key.length > 0);
      const scheduledPublishAtEntry = normalizedMeta.find((entry) => entry.key === HIDDEN_PUBLISH_AT_META_KEY);
      const normalizedScheduledPublishAt = scheduledPublishAtEntry
        ? normalizeScheduledPublishAt(scheduledPublishAtEntry.value)
        : { ok: true as const, value: null as string | null };
      if (!normalizedScheduledPublishAt.ok) {
        return { error: normalizedScheduledPublishAt.error };
      }
      const persistedMeta = normalizedMeta
        .filter((entry) => entry.key !== HIDDEN_PUBLISH_AT_META_KEY)
        .concat(
          normalizedScheduledPublishAt.value
            ? [{ key: HIDDEN_PUBLISH_AT_META_KEY, value: normalizedScheduledPublishAt.value }]
            : [],
        );
      await replaceSiteDomainPostMeta({
        siteId: existing.siteId,
        dataDomainKey: existing.dataDomainKey,
        postId: data.id,
        entries: persistedMeta,
      });
      await syncContentPublishScheduleForPost({
        post: {
          id: postRecord.id,
          siteId: postRecord.siteId || existing.siteId,
          title:
            typeof data.title === "string" && data.title.trim().length > 0
              ? data.title
              : existingPost?.title ?? null,
        },
        publishAt: normalizedScheduledPublishAt.value,
        createIfMissing: true,
      });
    }

    const taxonomyRows = await withResolvedSiteTaxonomyTables(
      existing.siteId,
      async ({ termRelationshipsTable, termTaxonomiesTable }) =>
        db
          .select({
            id: termTaxonomiesTable.id,
            taxonomy: termTaxonomiesTable.taxonomy,
          })
          .from(termRelationshipsTable)
          .innerJoin(termTaxonomiesTable, eq(termRelationshipsTable.termTaxonomyId, termTaxonomiesTable.id))
          .where(eq(termRelationshipsTable.objectId, data.id)),
    );

    const categories = taxonomyRows
      .filter((row) => row.taxonomy === "category")
      .map((row) => ({ categoryId: row.id }));
    const tags = taxonomyRows
      .filter((row) => row.taxonomy === "tag")
      .map((row) => ({ tagId: row.id }));

    const meta = await listSiteDomainPostMeta({
      siteId: existing.siteId,
      dataDomainKey: existing.dataDomainKey,
      postId: data.id,
    });

    if (createdFresh) {
      await emitCmsLifecycleEvent({
        name: "custom_event",
        siteId: existing.siteId,
        payload: {
          event: "content_created",
          contentType: existing.dataDomainKey,
          contentId: postRecord.id,
        },
      });
    }

    const siteId = postRecord.siteId || existing.siteId;
    const previousSlug = String(existingPost?.slug || "").trim();
    const nextSlug = String(postRecord.slug || fallbackCreateSlug).trim();
    if (siteId) {
      const siteRow = await db.query.sites.findFirst({
        where: eq(sites.id, siteId),
        columns: { subdomain: true, customDomain: true },
      });
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
      if (siteRow?.subdomain) {
        const domain = `${siteRow.subdomain}.${rootDomain}`;
        revalidateTag(`${domain}-posts`, "max");
        if (previousSlug) {
          revalidateTag(`${domain}-${previousSlug}`, "max");
        }
        if (nextSlug) {
          revalidateTag(`${domain}-${nextSlug}`, "max");
        }
      }
      if (siteRow?.customDomain) {
        revalidateTag(`${siteRow.customDomain}-posts`, "max");
        if (previousSlug) {
          revalidateTag(`${siteRow.customDomain}-${previousSlug}`, "max");
        }
        if (nextSlug) {
          revalidateTag(`${siteRow.customDomain}-${nextSlug}`, "max");
        }
      }
    }
    revalidatePublicContentCache();

    return {
      ...postRecord,
      categories,
      tags,
      meta,
      created: createdFresh,
    };
  } catch (error: any) {
    console.error("persistDomainPostUpdateForUser error:", error);
    return { error: error.message };
  }
}
