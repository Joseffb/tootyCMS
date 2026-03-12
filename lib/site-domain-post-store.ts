import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import db from "@/lib/db";
import { isMissingRelationError } from "@/lib/db-errors";
import {
  ensureSiteDomainTypeTables,
  resetSiteDomainTypeTablesCache,
  siteTableExists,
} from "@/lib/site-domain-type-tables";
import { sites } from "@/lib/schema";
import { listSiteDataDomains } from "@/lib/site-data-domain-registry";

type QueryRows<T> = { rows?: T[] };

export type SiteDomainDefinition = {
  id: number;
  key: string;
  label: string;
  description: string;
  settings: Record<string, unknown>;
  isActive: boolean;
  contentTable: string;
  metaTable: string;
};

export type SiteDomainPostRecord = {
  id: string;
  siteId: string;
  dataDomainId: number;
  dataDomainKey: string;
  dataDomainLabel: string;
  title: string;
  description: string;
  content: string;
  password: string;
  usePassword: boolean;
  layout: string | null;
  slug: string;
  image: string;
  imageBlurhash: string;
  published: boolean;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ListSiteDomainPostsInput = {
  siteId: string;
  dataDomainId?: number;
  dataDomainKey?: string;
  postId?: string;
  slug?: string;
  ids?: string[];
  includeInactiveDomains?: boolean;
  published?: boolean;
  includeContent?: boolean;
  limit?: number;
};

type CreateSiteDomainPostInput = {
  siteId: string;
  dataDomainId?: number;
  dataDomainKey?: string;
  userId?: string | null;
  id?: string;
  title?: string | null;
  description?: string | null;
  content?: string | null;
  password?: string | null;
  usePassword?: boolean | null;
  layout?: string | null;
  slug: string;
  image?: string | null;
  imageBlurhash?: string | null;
  published?: boolean;
};

type UpdateSiteDomainPostInput = {
  siteId: string;
  postId: string;
  dataDomainKey?: string;
  patch: {
    title?: string | null;
    description?: string | null;
    content?: string | null;
    password?: string | null;
    usePassword?: boolean | null;
    layout?: string | null;
    slug?: string | null;
    image?: string | null;
    imageBlurhash?: string | null;
    published?: boolean;
  };
};

function normalizeDomainKey(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const DEFAULT_IMAGE_BLURHASH =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAhCAYAAACbffiEAAAACXBIWXMAABYlAAAWJQFJUiTwAAABfUlEQVR4nN3XyZLDIAwE0Pz/v3q3r55JDlSBplsIEI49h76k4opexCK/juP4eXjOT149f2Tf9ySPgcjCc7kdpBTgDPKByKK2bTPFEdMO0RDrusJ0wLRBGCIuelmWJAjkgPGDSIQEMBDCfA2CEPM80+Qwl0JkNxBimiaYGOTUlXYI60YoehzHJDEm7kxjV3whOQTD3AaCuhGKHoYhyb+CBMwjIAFz647kTqyapdV4enGINuDJMSScPmijSwjCaHeLcT77C7EC0C1ugaCTi2HYfAZANgj6Z9A8xY5eiYghDMNQBJNCWhASot0jGsSCUiHWZcSGQjaWWCDaGMOWnsCcn2QhVkRuxqqNxMSdUSElCDbp1hbNOsa6Ugxh7xXauF4DyM1m5BLtCylBXgaxvPXVwEoOBjeIFVODtW74oj1yBQah3E8tyz3SkpolKS9Geo9YMD1QJR1Go4oJkgO1pgbNZq0AOUPChyjvh7vlXaQa+X1UXwKxgHokB2XPxbX+AnijwIU4ahazAAAAAElFTkSuQmCC";

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, "\"\"")}"`;
}

function normalizeSettings(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizeResultRows<T>(value: unknown) {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeRows<T>(result: unknown) {
  return (result as QueryRows<T>)?.rows || [];
}

function isRetryablePgLockError(error: unknown) {
  const candidate = error as { code?: unknown } | null | undefined;
  return candidate?.code === "40P01" || candidate?.code === "55P03";
}

async function withDbRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryablePgLockError(error) || attempt === attempts) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

type SiteDomainTableRecoveryOptions = {
  requireContent?: boolean;
  requireMeta?: boolean;
};

const SITE_DOMAIN_TABLE_VISIBILITY_ATTEMPTS = 5;
const SITE_DOMAIN_QUERY_RECOVERY_ATTEMPTS = 8;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function areRequiredSiteDomainTablesVisible(
  tables: { contentTable: string; metaTable: string },
  options?: SiteDomainTableRecoveryOptions,
) {
  const checks: boolean[] = [];
  if (options?.requireContent !== false) {
    checks.push(await siteTableExists(tables.contentTable));
  }
  if (options?.requireMeta) {
    checks.push(await siteTableExists(tables.metaTable));
  }
  return checks.every(Boolean);
}

async function ensureSiteDomainTablesReady(
  siteId: string,
  domainKey: string,
  options?: SiteDomainTableRecoveryOptions,
  attempts = SITE_DOMAIN_TABLE_VISIBILITY_ATTEMPTS,
) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  let latest = await ensureSiteDomainTypeTables(normalizedSiteId, normalizedDomainKey);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await ensureSiteDomainTypeTables(normalizedSiteId, normalizedDomainKey);
    if (await areRequiredSiteDomainTablesVisible(latest, options)) {
      return latest;
    }
    if (attempt < attempts) {
      resetSiteDomainTypeTablesCache(normalizedSiteId, normalizedDomainKey);
      await sleep(Math.min(200 * attempt, 1000));
    }
  }
  return latest;
}

async function withSiteDomainTableRecovery<T>(
  siteId: string,
  domainKey: string,
  options: SiteDomainTableRecoveryOptions,
  run: (tables: { contentTable: string; metaTable: string }) => Promise<T>,
): Promise<T> {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  const maxAttempts = SITE_DOMAIN_QUERY_RECOVERY_ATTEMPTS;
  let tables = await ensureSiteDomainTablesReady(normalizedSiteId, normalizedDomainKey, options);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run(tables);
    } catch (error) {
      if (!isMissingRelationError(error) || attempt === maxAttempts) throw error;
    }
    resetSiteDomainTypeTablesCache(normalizedSiteId, normalizedDomainKey);
    await sleep(Math.min(200 * attempt, 1200));
    tables = await ensureSiteDomainTablesReady(normalizedSiteId, normalizedDomainKey, options);
  }
  throw new Error("Unreachable site domain table recovery state.");
}

function normalizeDefinition(
  input: {
    id: number;
    key: string;
    label: string;
    description: string | null;
    settings: unknown;
    isActive: boolean;
  },
  tables: { contentTable: string; metaTable: string },
): SiteDomainDefinition {
  return {
    id: Number(input.id),
    key: String(input.key || "").trim(),
    label: String(input.label || input.key || "").trim(),
    description: String(input.description || ""),
    settings: normalizeSettings(input.settings),
    isActive: Boolean(input.isActive),
    contentTable: tables.contentTable,
    metaTable: tables.metaTable,
  };
}

async function listDomainDefinitionsRaw(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return [];
  try {
    const rows = await listSiteDataDomains(normalizedSiteId, { includeInactive: true });
    return normalizeResultRows<{
      id: number;
      key: string;
      label: string;
      description: string | null;
      settings: unknown;
      isActive: boolean;
    }>(rows as unknown[]);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listSiteDomainDefinitions(
  siteId: string,
  options?: { includeInactive?: boolean },
) {
  const rows = await listDomainDefinitionsRaw(siteId);
  const includeInactive = Boolean(options?.includeInactive);
  const definitions: SiteDomainDefinition[] = [];
  for (const row of rows) {
    if (!includeInactive && !row.isActive) continue;
    const key = String(row.key || "").trim();
    if (!key) continue;
    const tables = await ensureSiteDomainTypeTables(siteId, key);
    definitions.push(normalizeDefinition(row as any, tables));
  }
  return definitions;
}

async function resolveSiteDomainDefinition(
  siteId: string,
  input: { dataDomainId?: number; dataDomainKey?: string; includeInactive?: boolean },
) {
  const definitions = await listSiteDomainDefinitions(siteId, {
    includeInactive: Boolean(input.includeInactive),
  });
  const byId = Number(input.dataDomainId || 0);
  const byKey = normalizeDomainKey(String(input.dataDomainKey || ""));
  return (
    definitions.find((definition) => {
      if (byId && definition.id === byId) return true;
      if (byKey && definition.key.toLowerCase() === byKey) return true;
      return false;
    }) || null
  );
}

function toDomainPostRecord(
  row: Record<string, unknown>,
  definition: SiteDomainDefinition,
  siteId: string,
): SiteDomainPostRecord {
  return {
    id: String(row.id || ""),
    siteId,
    dataDomainId: definition.id,
    dataDomainKey: definition.key,
    dataDomainLabel: definition.label,
    title: String(row.title || ""),
    description: String(row.description || ""),
    content: String(row.content || ""),
    password: String(row.password || ""),
    usePassword: Boolean(row.usePassword),
    layout: row.layout == null ? null : String(row.layout),
    slug: String(row.slug || ""),
    image: String(row.image || ""),
    imageBlurhash: String(row.imageBlurhash || DEFAULT_IMAGE_BLURHASH),
    published: Boolean(row.published),
    userId: row.userId == null ? null : String(row.userId),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt || 0)),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt || 0)),
  };
}

export async function listSiteDomainPosts(input: ListSiteDomainPostsInput) {
  const siteId = String(input.siteId || "").trim();
  if (!siteId) return [];
  const normalizedDomainKey = normalizeDomainKey(String(input.dataDomainKey || ""));
  const definitions = await listSiteDomainDefinitions(siteId, {
    includeInactive: Boolean(input.includeInactiveDomains),
  });
  const filteredDefinitions = definitions.filter((definition) => {
    if (input.dataDomainId && definition.id !== Number(input.dataDomainId)) return false;
    if (normalizedDomainKey && definition.key !== normalizedDomainKey) return false;
    return true;
  });

  const postIds = Array.isArray(input.ids)
    ? new Set(input.ids.map((value) => String(value || "").trim()).filter(Boolean))
    : null;
  const out: SiteDomainPostRecord[] = [];
  for (const definition of filteredDefinitions) {
    const where: SQL[] = [];
    if (typeof input.published === "boolean") where.push(sql`"published" = ${input.published}`);
    if (input.postId) where.push(sql`"id" = ${String(input.postId).trim()}`);
    if (input.slug) where.push(sql`"slug" = ${String(input.slug).trim()}`);

    let result: unknown;
    try {
      result = await withSiteDomainTableRecovery(
        siteId,
        definition.key,
        { requireContent: true },
        async (tables) =>
          withDbRetry(() => db.execute(sql`
            SELECT
              "id",
              "title",
              "description",
              "content",
              "password",
              "usePassword",
              "layout",
              "slug",
              "image",
              "imageBlurhash",
              "published",
              "userId",
              "createdAt",
              "updatedAt"
            FROM ${sql.raw(quoted(tables.contentTable))}
            ${where.length > 0 ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
            ORDER BY "updatedAt" DESC
            ${input.limit ? sql`LIMIT ${Math.max(1, Math.trunc(input.limit))}` : sql``}
          `)),
      );
    } catch (error) {
      if (isMissingRelationError(error)) continue;
      throw error;
    }
    const rows = normalizeRows<Record<string, unknown>>(result);
    for (const row of rows) {
      const normalized = toDomainPostRecord(row, definition, siteId);
      if (postIds && !postIds.has(normalized.id)) continue;
      if (!input.includeContent) normalized.content = "";
      out.push(normalized);
    }
  }

  out.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  if (input.limit && out.length > input.limit) {
    return out.slice(0, input.limit);
  }
  return out;
}

export async function getSiteDomainPostById(input: { siteId: string; postId: string; dataDomainKey?: string }) {
  const rows = await listSiteDomainPosts({
    siteId: input.siteId,
    postId: input.postId,
    dataDomainKey: input.dataDomainKey,
    includeInactiveDomains: true,
    includeContent: true,
    limit: 1,
  });
  return rows[0] || null;
}

export async function getSiteDomainPostBySlug(input: {
  siteId: string;
  slug: string;
  dataDomainKey?: string;
  published?: boolean;
}) {
  const rows = await listSiteDomainPosts({
    siteId: input.siteId,
    slug: input.slug,
    dataDomainKey: input.dataDomainKey,
    includeInactiveDomains: true,
    includeContent: true,
    published: input.published,
    limit: 1,
  });
  return rows[0] || null;
}

export async function createSiteDomainPost(input: CreateSiteDomainPostInput) {
  const siteId = String(input.siteId || "").trim();
  if (!siteId) throw new Error("siteId is required.");
  const definition = await resolveSiteDomainDefinition(siteId, {
    dataDomainId: input.dataDomainId,
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) throw new Error("Data domain not found for site.");

  const id = String(input.id || "").trim() || createId();
  const slug = String(input.slug || "").trim();
  if (!slug) throw new Error("slug is required.");

  const result = await withSiteDomainTableRecovery(
    siteId,
    definition.key,
    { requireContent: true },
    async (tables) =>
      withDbRetry(() => db.execute(sql`
        INSERT INTO ${sql.raw(quoted(tables.contentTable))}
          ("id", "title", "description", "content", "password", "usePassword", "layout", "slug", "image", "imageBlurhash", "published", "userId")
        VALUES
          (
            ${id},
            ${String(input.title || "")},
            ${String(input.description || "")},
            ${String(input.content || "")},
            ${String(input.password || "")},
            ${Boolean(input.usePassword)},
            ${input.layout == null ? null : String(input.layout)},
            ${slug},
            ${String(input.image || "")},
            ${String(input.imageBlurhash || DEFAULT_IMAGE_BLURHASH)},
            ${Boolean(input.published)},
            ${input.userId ? String(input.userId) : null}
          )
        RETURNING
          "id",
          "title",
          "description",
          "content",
          "password",
          "usePassword",
          "layout",
          "slug",
          "image",
          "imageBlurhash",
          "published",
          "userId",
          "createdAt",
          "updatedAt"
      `)),
  );
  const row = normalizeRows<Record<string, unknown>>(result)[0];
  if (!row) return null;
  return toDomainPostRecord(row, definition, siteId);
}

export async function updateSiteDomainPostById(input: UpdateSiteDomainPostInput) {
  const siteId = String(input.siteId || "").trim();
  const postId = String(input.postId || "").trim();
  if (!siteId || !postId) throw new Error("siteId and postId are required.");

  const existing = await getSiteDomainPostById({
    siteId,
    postId,
    dataDomainKey: input.dataDomainKey,
  });
  if (!existing) return null;
  const definition = await resolveSiteDomainDefinition(siteId, {
    dataDomainId: existing.dataDomainId,
    dataDomainKey: existing.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) return null;

  const setClauses: SQL[] = [];
  if ("title" in input.patch) setClauses.push(sql`"title" = ${String(input.patch.title || "")}`);
  if ("description" in input.patch) setClauses.push(sql`"description" = ${String(input.patch.description || "")}`);
  if ("content" in input.patch) setClauses.push(sql`"content" = ${String(input.patch.content || "")}`);
  if ("password" in input.patch) setClauses.push(sql`"password" = ${String(input.patch.password || "")}`);
  if ("usePassword" in input.patch) setClauses.push(sql`"usePassword" = ${Boolean(input.patch.usePassword)}`);
  if ("layout" in input.patch) setClauses.push(sql`"layout" = ${input.patch.layout == null ? null : String(input.patch.layout)}`);
  if ("slug" in input.patch) setClauses.push(sql`"slug" = ${String(input.patch.slug || "")}`);
  if ("image" in input.patch) setClauses.push(sql`"image" = ${String(input.patch.image || "")}`);
  if ("imageBlurhash" in input.patch) setClauses.push(sql`"imageBlurhash" = ${String(input.patch.imageBlurhash || DEFAULT_IMAGE_BLURHASH)}`);
  if ("published" in input.patch) setClauses.push(sql`"published" = ${Boolean(input.patch.published)}`);
  setClauses.push(sql`"updatedAt" = NOW()`);

  const result = await withSiteDomainTableRecovery(
    siteId,
    definition.key,
    { requireContent: true },
    async (tables) =>
      withDbRetry(() => db.execute(sql`
        UPDATE ${sql.raw(quoted(tables.contentTable))}
        SET ${sql.join(setClauses, sql`, `)}
        WHERE "id" = ${postId}
        RETURNING
          "id",
          "title",
          "description",
          "content",
          "password",
          "usePassword",
          "layout",
          "slug",
          "image",
          "imageBlurhash",
          "published",
          "userId",
          "createdAt",
          "updatedAt"
      `)),
  );
  const row = normalizeRows<Record<string, unknown>>(result)[0];
  if (!row) return null;
  return toDomainPostRecord(row, definition, siteId);
}

export async function deleteSiteDomainPostById(input: {
  siteId: string;
  postId: string;
  dataDomainKey?: string;
}) {
  const siteId = String(input.siteId || "").trim();
  const postId = String(input.postId || "").trim();
  if (!siteId || !postId) return null;
  const existing = await getSiteDomainPostById({
    siteId,
    postId,
    dataDomainKey: input.dataDomainKey,
  });
  if (!existing) return null;
  const definition = await resolveSiteDomainDefinition(siteId, {
    dataDomainId: existing.dataDomainId,
    dataDomainKey: existing.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) return null;
  await withSiteDomainTableRecovery(
    siteId,
    definition.key,
    { requireContent: true, requireMeta: true },
    async (tables) => {
      await withDbRetry(() =>
        db.execute(sql`DELETE FROM ${sql.raw(quoted(tables.metaTable))} WHERE "domainPostId" = ${postId}`),
      );
      await withDbRetry(() =>
        db.execute(sql`DELETE FROM ${sql.raw(quoted(tables.contentTable))} WHERE "id" = ${postId}`),
      );
    },
  );
  return existing;
}

export async function listSiteDomainPostMeta(input: {
  siteId: string;
  dataDomainKey: string;
  postId: string;
}) {
  const definition = await resolveSiteDomainDefinition(input.siteId, {
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  let result: unknown;
  try {
    if (!definition) return [];
    result = await withSiteDomainTableRecovery(
      input.siteId,
      definition.key,
      { requireContent: false, requireMeta: true },
      async (tables) =>
        withDbRetry(() => db.execute(sql`
          SELECT "key", "value"
          FROM ${sql.raw(quoted(tables.metaTable))}
          WHERE "domainPostId" = ${String(input.postId || "").trim()}
          ORDER BY "key" ASC
        `)),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return normalizeRows<{ key: string; value: string }>(result).map((row) => ({
    key: String(row.key || ""),
    value: String(row.value || ""),
  }));
}

export async function listSiteDomainPostMetaMany(input: {
  siteId: string;
  dataDomainKey: string;
  postIds: string[];
  keys?: string[];
}) {
  const definition = await resolveSiteDomainDefinition(input.siteId, {
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  const postIds = input.postIds.map((value) => String(value || "").trim()).filter(Boolean);
  if (!postIds.length) return [];
  const where: SQL[] = [sql`"domainPostId" IN (${sql.join(postIds.map((value) => sql`${value}`), sql`, `)})`];
  const keys = (input.keys || []).map((value) => String(value || "").trim()).filter(Boolean);
  if (keys.length) {
    where.push(sql`"key" IN (${sql.join(keys.map((value) => sql`${value}`), sql`, `)})`);
  }
  let result: unknown;
  try {
    if (!definition) return [];
    result = await withSiteDomainTableRecovery(
      input.siteId,
      definition.key,
      { requireContent: false, requireMeta: true },
      async (tables) =>
        withDbRetry(() => db.execute(sql`
          SELECT "domainPostId", "key", "value"
          FROM ${sql.raw(quoted(tables.metaTable))}
          WHERE ${sql.join(where, sql` AND `)}
        `)),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return normalizeRows<{ domainPostId: string; key: string; value: string }>(result).map((row) => ({
    domainPostId: String(row.domainPostId || ""),
    key: String(row.key || ""),
    value: String(row.value || ""),
  }));
}

export async function replaceSiteDomainPostMeta(input: {
  siteId: string;
  dataDomainKey: string;
  postId: string;
  entries: Array<{ key: string; value: string }>;
}) {
  const definition = await resolveSiteDomainDefinition(input.siteId, {
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) return;
  const postId = String(input.postId || "").trim();
  if (!postId) return;
  await withSiteDomainTableRecovery(
    input.siteId,
    definition.key,
    { requireContent: false, requireMeta: true },
    async (tables) => {
      await withDbRetry(() =>
        db.execute(sql`DELETE FROM ${sql.raw(quoted(tables.metaTable))} WHERE "domainPostId" = ${postId}`),
      );
      for (const entry of input.entries) {
        const key = String(entry.key || "").trim();
        if (!key) continue;
        await withDbRetry(() => db.execute(sql`
          INSERT INTO ${sql.raw(quoted(tables.metaTable))} ("domainPostId", "key", "value")
          VALUES (${postId}, ${key}, ${String(entry.value || "")})
          ON CONFLICT ("domainPostId", "key")
          DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
        `));
      }
    },
  );
}

export async function upsertSiteDomainPostMeta(input: {
  siteId: string;
  dataDomainKey: string;
  postId: string;
  key: string;
  value: string;
}) {
  const definition = await resolveSiteDomainDefinition(input.siteId, {
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) return;
  const postId = String(input.postId || "").trim();
  const key = String(input.key || "").trim();
  if (!postId || !key) return;
  await withSiteDomainTableRecovery(
    input.siteId,
    definition.key,
    { requireContent: false, requireMeta: true },
    async (tables) =>
      withDbRetry(() => db.execute(sql`
        INSERT INTO ${sql.raw(quoted(tables.metaTable))} ("domainPostId", "key", "value")
        VALUES (${postId}, ${key}, ${String(input.value || "")})
        ON CONFLICT ("domainPostId", "key")
        DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      `)),
  );
}

export async function deleteSiteDomainPostMeta(input: {
  siteId: string;
  dataDomainKey: string;
  postId: string;
  key: string;
}) {
  const definition = await resolveSiteDomainDefinition(input.siteId, {
    dataDomainKey: input.dataDomainKey,
    includeInactive: true,
  });
  if (!definition) return;
  const postId = String(input.postId || "").trim();
  const key = String(input.key || "").trim();
  if (!postId || !key) return;
  await withSiteDomainTableRecovery(
    input.siteId,
    definition.key,
    { requireContent: false, requireMeta: true },
    async (tables) =>
      withDbRetry(() => db.execute(sql`
        DELETE FROM ${sql.raw(quoted(tables.metaTable))}
        WHERE "domainPostId" = ${postId}
          AND "key" = ${key}
      `)),
  );
}

export async function findDomainPostForMutation(postId: string, siteIdHint?: string | null) {
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) return null;

  const siteId = String(siteIdHint || "").trim();
  if (siteId) {
    const post = await getSiteDomainPostById({ siteId, postId: normalizedPostId });
    return post;
  }

  const siteRowsRaw = await db.query?.sites?.findMany?.({ columns: { id: true } });
  const siteRows = Array.isArray(siteRowsRaw) ? siteRowsRaw : [];
  for (const site of siteRows) {
    const post = await getSiteDomainPostById({ siteId: site.id, postId: normalizedPostId });
    if (post) return post;
  }
  return null;
}

export async function countSiteDomainPostUsageByDomain(siteId?: string | null) {
  const out = new Map<number, number>();
  const normalizedSiteId = String(siteId || "").trim();
  const siteIds = normalizedSiteId
    ? [normalizedSiteId]
    : (await db.query.sites.findMany({ columns: { id: true } })).map((site) => site.id);

  for (const currentSiteId of siteIds) {
    const definitions = await listSiteDomainDefinitions(currentSiteId, { includeInactive: true });
    for (const definition of definitions) {
      let result: unknown;
      try {
        result = await withSiteDomainTableRecovery(
          currentSiteId,
          definition.key,
          { requireContent: true },
          async (tables) =>
            withDbRetry(() =>
              db.execute(sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(quoted(tables.contentTable))}`),
            ),
        );
      } catch (error) {
        if (isMissingRelationError(error)) {
          out.set(definition.id, out.get(definition.id) || 0);
          continue;
        }
        throw error;
      }
      const count = Number(normalizeRows<{ count: number }>(result)[0]?.count || 0);
      out.set(definition.id, (out.get(definition.id) || 0) + count);
    }
  }

  return out;
}

export async function listNetworkDomainPosts(input: {
  siteIds: string[];
  published?: boolean;
  includeContent?: boolean;
}) {
  const posts: SiteDomainPostRecord[] = [];
  for (const siteId of input.siteIds) {
    let sitePosts: SiteDomainPostRecord[] = [];
    try {
      sitePosts = await listSiteDomainPosts({
        siteId,
        published: input.published,
        includeInactiveDomains: false,
        includeContent: Boolean(input.includeContent),
      });
    } catch (error) {
      if (isMissingRelationError(error)) continue;
      throw error;
    }
    posts.push(...sitePosts);
  }
  posts.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  return posts;
}

export async function resolveSiteIdForDomainPostId(postId: string) {
  const normalizedPostId = String(postId || "").trim();
  if (!normalizedPostId) return null;
  const rowsRaw = await db.query?.sites?.findMany?.({ columns: { id: true } });
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  for (const row of rows) {
    const match = await getSiteDomainPostById({ siteId: row.id, postId: normalizedPostId });
    if (match?.siteId) return match.siteId;
  }
  return null;
}

export async function listAssignedDomainKeysForSite(siteId: string) {
  const definitions = await listSiteDomainDefinitions(siteId, { includeInactive: true });
  return definitions.map((definition) => definition.key);
}

export async function ensureAllSiteDomainTablesForSite(siteId: string) {
  const definitions = await listSiteDomainDefinitions(siteId, { includeInactive: true });
  for (const definition of definitions) {
    await ensureSiteDomainTypeTables(siteId, definition.key);
  }
}

export async function getSiteNameMap(siteIds: string[]) {
  if (!siteIds.length) return new Map<string, string>();
  const rows = await withDbRetry(() => db
    .select({
      id: sites.id,
      name: sites.name,
    })
    .from(sites)
    .where(inArray(sites.id, siteIds)));
  return new Map(rows.map((row) => [row.id, String(row.name || "")]));
}
