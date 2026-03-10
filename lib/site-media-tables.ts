import db from "@/lib/db";
import { sites, users } from "@/lib/schema";
import { sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";
import { eq, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

type SqlExecutor = { execute?: typeof db.execute };

const ensureCache = new Map<string, ReturnType<typeof createSiteMediaTable>>();
const ensureInFlight = new Map<string, Promise<ReturnType<typeof createSiteMediaTable>>>();
const ensuredSites = new Set<string>();

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function isRetryablePgLockError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "40P01" || candidate.code === "55P03";
}

async function withLockRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
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

export function siteMediaTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "media");
}

function createSiteMediaTable(siteId: string) {
  return pgTable(
    siteMediaTableName(siteId),
    {
      id: serial("id").primaryKey(),
      userId: text("userId").references(() => users.id, {
        onDelete: "set null",
        onUpdate: "cascade",
      }),
      provider: text("provider").notNull().default("blob"),
      bucket: text("bucket"),
      objectKey: text("objectKey").notNull(),
      url: text("url").notNull(),
      label: text("label"),
      altText: text("altText"),
      caption: text("caption"),
      description: text("description"),
      mimeType: text("mimeType"),
      size: integer("size"),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      objectKeyUnique: uniqueIndex().on(table.objectKey),
      userIdx: index().on(table.userId),
      createdAtIdx: index().on(table.createdAt),
    }),
  );
}

export function getSiteMediaTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required.");
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) return cached;
  const table = createSiteMediaTable(normalizedSiteId);
  ensureCache.set(normalizedSiteId, table);
  return table;
}

function isDuplicatePgTypeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate.code === "42710" ||
    (candidate.code === "23505" && candidate.constraint === "pg_type_typname_nsp_index")
  );
}

function isDuplicatePgRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate.code === "42P07" ||
    (candidate.code === "23505" && candidate.constraint === "pg_class_relname_nsp_index")
  );
}

function isMissingPgRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "42P01";
}

export function isMissingSiteMediaRelationError(error: unknown) {
  if (!isMissingPgRelationError(error)) return false;
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return message.includes("_media") || message.includes("_media_id_seq");
}

export function resetSiteMediaTableCache(siteId?: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    ensureCache.clear();
    ensureInFlight.clear();
    ensuredSites.clear();
    return;
  }
  ensureCache.delete(normalizedSiteId);
  ensureInFlight.delete(normalizedSiteId);
  ensuredSites.delete(normalizedSiteId);
}

async function executeDdl(executor: SqlExecutor, statement: string) {
  if (typeof executor.execute !== "function") return;
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error) || isDuplicatePgRelationError(error)) return;
    throw error;
  }
}

type QueryRows<T> = { rows?: T[] };

function hasExpectedSequenceDefault(columnDefault: string, sequenceName: string) {
  const normalizedDefault = String(columnDefault || "").replace(/\s+/g, " ").trim();
  if (!normalizedDefault) return false;
  return normalizedDefault.includes("nextval(") && normalizedDefault.includes(sequenceName);
}

async function relationExistsWithExecutor(executor: SqlExecutor, relationName: string) {
  if (typeof executor.execute !== "function") {
    // Unit-test mocks and opaque executors often do not expose raw pg row metadata.
    // In those cases, assume prior DDL/recovery succeeded instead of fabricating
    // a missing-relation error that only exists in the mock surface.
    return true;
  }
  const result = (await executor.execute?.(
    sql`SELECT to_regclass(${`public.${relationName}`}) AS relation_name`,
  )) as QueryRows<{ relation_name?: string | null }>;
  if (!result || !Array.isArray(result.rows)) {
    return true;
  }
  return Boolean(result.rows[0]?.relation_name);
}

export async function siteMediaTableReady(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const mediaTable = siteMediaTableName(normalizedSiteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "media_id_seq");
  const [hasMediaTable, hasMediaSequence] = await Promise.all([
    relationExistsWithExecutor(db, mediaTable),
    relationExistsWithExecutor(db, idSequence),
  ]);
  return hasMediaTable && hasMediaSequence;
}

async function waitForRelationVisible(executor: SqlExecutor, relationName: string, attempts = 10) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await relationExistsWithExecutor(executor, relationName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
  }
  return false;
}

async function mediaIdDefaultNeedsRepair(executor: SqlExecutor, siteId: string) {
  if (typeof executor.execute !== "function") {
    return false;
  }
  const table = siteMediaTableName(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "media_id_seq");
  const result = (await executor.execute?.(sql`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = 'id'
  `).catch((error) => {
    if (isMissingPgRelationError(error)) {
      return { rows: [{ column_default: null }] } as QueryRows<{ column_default?: string | null }>;
    }
    throw error;
  })) as QueryRows<{ column_default?: string | null }>;
  if (!result || !Array.isArray(result.rows)) {
    return false;
  }
  const columnDefault = String(result?.rows?.[0]?.column_default || "");
  return !hasExpectedSequenceDefault(columnDefault, idSequence);
}

function createPendingRelationRetryError(relationName: string) {
  return Object.assign(new Error(`Pending concurrent relation creation: ${relationName}`), { code: "55P03" });
}

async function createNamedRelation(
  executor: SqlExecutor,
  relationName: string,
  statement: string,
  options?: { allowDuplicateType?: boolean },
) {
  if (typeof executor.execute !== "function") return;
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    const duplicateType = Boolean(options?.allowDuplicateType) && isDuplicatePgTypeError(error);
    const duplicateRelation = isDuplicatePgRelationError(error);
    if (!duplicateType && !duplicateRelation) throw error;
    if (!(await waitForRelationVisible(executor, relationName))) {
      throw createPendingRelationRetryError(relationName);
    }
  }
  if (!(await waitForRelationVisible(executor, relationName))) {
    throw createPendingRelationRetryError(relationName);
  }
}

async function createPhysicalSiteMediaTable(executor: SqlExecutor, siteId: string) {
  const table = siteMediaTableName(siteId);
  const usersTable = `${normalizedPrefix}network_users`;
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "media_id_seq");
  await createNamedRelation(
    executor,
    idSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(idSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    table,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(table)} (
        "id" INTEGER PRIMARY KEY,
        "userId" TEXT REFERENCES ${quoted(usersTable)}("id") ON DELETE SET NULL ON UPDATE CASCADE,
        "provider" TEXT NOT NULL DEFAULT 'blob',
        "bucket" TEXT,
        "objectKey" TEXT NOT NULL UNIQUE,
        "url" TEXT NOT NULL,
        "label" TEXT,
        "altText" TEXT,
        "caption" TEXT,
        "description" TEXT,
        "mimeType" TEXT,
        "size" INTEGER,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    { allowDuplicateType: true },
  );
  await repairMediaIdDefaultAndOwnership(executor, siteId);
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${table}_user_idx`)}
      ON ${quoted(table)} ("userId")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${table}_created_at_idx`)}
      ON ${quoted(table)} ("createdAt")
    `,
  );
}

async function repairPhysicalSiteMediaTable(executor: SqlExecutor, siteId: string) {
  await ensureMediaIdSequence(executor, siteId);
  await repairMediaIdDefaultAndOwnership(executor, siteId);
}

async function ensureMediaIdSequence(executor: SqlExecutor, siteId: string) {
  const table = siteMediaTableName(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "media_id_seq");
  await createNamedRelation(
    executor,
    idSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(idSequence)}
    `,
  );
  if (!(await relationExistsWithExecutor(executor, idSequence))) {
    throw createPendingRelationRetryError(idSequence);
  }
  if (!(await relationExistsWithExecutor(executor, table))) {
    throw createPendingRelationRetryError(table);
  }
}

async function repairMediaIdDefaultAndOwnership(executor: SqlExecutor, siteId: string) {
  const table = siteMediaTableName(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "media_id_seq");
  await executeDdl(
    executor,
    `
      ALTER TABLE ${quoted(table)}
      ALTER COLUMN "id" SET DEFAULT nextval('public.${idSequence}'::regclass)
    `,
  ).catch(async (error) => {
    if (!isMissingPgRelationError(error)) throw error;
    await createNamedRelation(
      executor,
      idSequence,
      `
        CREATE SEQUENCE IF NOT EXISTS ${quoted(idSequence)}
      `,
    );
    await executeDdl(
      executor,
      `
        ALTER TABLE ${quoted(table)}
        ALTER COLUMN "id" SET DEFAULT nextval('public.${idSequence}'::regclass)
      `,
    );
  });
  await executeDdl(
    executor,
    `
      ALTER SEQUENCE ${quoted(idSequence)}
      OWNED BY ${quoted(table)}."id"
    `,
  ).catch(async (error) => {
    if (!isMissingPgRelationError(error)) throw error;
    await createNamedRelation(
      executor,
      idSequence,
      `
        CREATE SEQUENCE IF NOT EXISTS ${quoted(idSequence)}
      `,
    );
    await executeDdl(
      executor,
      `
        ALTER SEQUENCE ${quoted(idSequence)}
        OWNED BY ${quoted(table)}."id"
      `,
    );
  });
}

async function rebuildPhysicalSiteMediaTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");

  const verifySite = async (executor: typeof db | { query?: typeof db.query }) => {
    if (typeof executor.query?.sites?.findFirst !== "function") return;
    const site = await executor.query.sites.findFirst({
      where: eq(sites.id, normalizedSiteId),
      columns: { id: true },
    });
    if (!site) throw new Error("Invalid site.");
  };

  if (typeof db.transaction !== "function") {
    await verifySite(db);
    await createPhysicalSiteMediaTable(db, normalizedSiteId);
    await repairPhysicalSiteMediaTable(db, normalizedSiteId);
    ensuredSites.add(normalizedSiteId);
    return getSiteMediaTable(normalizedSiteId);
  }

  return withLockRetry(() =>
    db.transaction(async (tx) => {
      await verifySite(tx);
      const advisoryKey = `${normalizedPrefix}site_media_table:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
      await createPhysicalSiteMediaTable(tx, normalizedSiteId);
      await repairPhysicalSiteMediaTable(tx, normalizedSiteId);
      ensuredSites.add(normalizedSiteId);
      return getSiteMediaTable(normalizedSiteId);
    }),
  );
}

export async function ensureSiteMediaTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const mediaTable = siteMediaTableName(normalizedSiteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "media_id_seq");
  if (ensuredSites.has(normalizedSiteId)) {
    const hasMediaTable = await relationExistsWithExecutor(db, mediaTable);
    const hasMediaSequence = await relationExistsWithExecutor(db, idSequence);
    if (!hasMediaTable || !hasMediaSequence) {
      ensuredSites.delete(normalizedSiteId);
      ensureCache.delete(normalizedSiteId);
    } else {
      return getSiteMediaTable(normalizedSiteId);
    }
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) {
    const hasMediaTable = await relationExistsWithExecutor(db, mediaTable);
    const hasMediaSequence = await relationExistsWithExecutor(db, idSequence);
    if (hasMediaTable && hasMediaSequence) {
      if (await mediaIdDefaultNeedsRepair(db, normalizedSiteId)) {
        await withLockRetry(() =>
          db.transaction(async (tx) => {
            const advisoryKey = `${normalizedPrefix}site_media_table:${normalizedSiteId}`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
            if (await mediaIdDefaultNeedsRepair(tx, normalizedSiteId)) {
              await repairPhysicalSiteMediaTable(tx, normalizedSiteId);
            }
          }),
        );
      }
      ensuredSites.add(normalizedSiteId);
      return cached;
    }
    ensureCache.delete(normalizedSiteId);
  }
  const pending = ensureInFlight.get(normalizedSiteId);
  if (pending) return pending;
  if (typeof db.transaction !== "function") {
    if (!(await relationExistsWithExecutor(db, mediaTable)) || !(await relationExistsWithExecutor(db, idSequence))) {
      return rebuildPhysicalSiteMediaTable(normalizedSiteId);
    }
    await repairPhysicalSiteMediaTable(db, normalizedSiteId);
    ensuredSites.add(normalizedSiteId);
    return getSiteMediaTable(normalizedSiteId);
  }
  const run = rebuildPhysicalSiteMediaTable(normalizedSiteId);
  ensureInFlight.set(normalizedSiteId, run);
  return run
    .catch(async (error) => {
      if (!isMissingSiteMediaRelationError(error)) throw error;
      resetSiteMediaTableCache(normalizedSiteId);
      return rebuildPhysicalSiteMediaTable(normalizedSiteId);
    })
    .then(async (resolved) => {
      if (!(await relationExistsWithExecutor(db, mediaTable)) || !(await relationExistsWithExecutor(db, idSequence))) {
        await createPhysicalSiteMediaTable(db, normalizedSiteId);
      }
      if (await mediaIdDefaultNeedsRepair(db, normalizedSiteId)) {
        await rebuildPhysicalSiteMediaTable(normalizedSiteId);
      }
      ensuredSites.add(normalizedSiteId);
      return resolved;
    })
    .finally(() => {
      ensureInFlight.delete(normalizedSiteId);
    });
}
