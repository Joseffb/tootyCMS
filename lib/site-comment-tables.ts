import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { sites } from "@/lib/schema";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const registryTableName = `${normalizedPrefix}site_comment_table_registry`;
const siteCommentCache = new Map<string, { tableIndex: number; commentsTable: string; commentMetaTable: string }>();
const siteCommentInFlight = new Map<string, Promise<{ tableIndex: number; commentsTable: string; commentMetaTable: string }>>();
let registryEnsured = false;
let registryEnsurePromise: Promise<void> | null = null;

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function commentsTableName(tableIndex: number) {
  return `${normalizedPrefix}site_${tableIndex}_comments`;
}

function commentMetaTableName(tableIndex: number) {
  return `${normalizedPrefix}site_${tableIndex}_comment_meta`;
}

type QueryRows<T> = { rows?: T[] };
type SqlExecutor = { execute: typeof db.execute };

function isDuplicatePgTypeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return candidate.code === "23505" && candidate.constraint === "pg_type_typname_nsp_index";
}

async function executeDdl(executor: SqlExecutor, statement: string) {
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error)) return;
    throw error;
  }
}

async function ensureRegistryTable(executor: SqlExecutor) {
  if (executor === db && registryEnsured) return;
  if (executor === db && registryEnsurePromise) return registryEnsurePromise;
  const run = async () => {
  const prefixedSites = `${normalizedPrefix}sites`;
  await executeDdl(executor, `
    CREATE TABLE IF NOT EXISTS ${quoted(registryTableName)} (
      "siteId" TEXT PRIMARY KEY REFERENCES ${quoted(prefixedSites)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "tableIndex" INTEGER NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    if (executor === db) registryEnsured = true;
  };
  if (executor === db) {
    registryEnsurePromise = run().finally(() => {
      if (!registryEnsured) registryEnsurePromise = null;
    });
    return registryEnsurePromise;
  }
  return run();
}

async function createPhysicalSiteCommentTables(executor: SqlExecutor, tableIndex: number) {
  const commentsTable = commentsTableName(tableIndex);
  const metaTable = commentMetaTableName(tableIndex);
  const prefixedUsers = `${normalizedPrefix}users`;

  await executeDdl(executor, `
    CREATE TABLE IF NOT EXISTS ${quoted(commentsTable)} (
      id TEXT PRIMARY KEY,
      author_id TEXT NULL REFERENCES ${quoted(prefixedUsers)}("id") ON DELETE SET NULL ON UPDATE CASCADE,
      context_type TEXT NOT NULL,
      context_id TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parent_id TEXT NULL REFERENCES ${quoted(commentsTable)}("id") ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await executeDdl(executor, `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_context_idx`)}
    ON ${quoted(commentsTable)} ("context_type", "context_id")
  `);
  await executeDdl(executor, `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_status_idx`)}
    ON ${quoted(commentsTable)} ("status")
  `);
  await executeDdl(executor, `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_author_idx`)}
    ON ${quoted(commentsTable)} ("author_id")
  `);

  await executeDdl(executor, `
    CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
      id BIGSERIAL PRIMARY KEY,
      site_comment_id TEXT NOT NULL REFERENCES ${quoted(commentsTable)}("id") ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (site_comment_id, key)
    )
  `);
  await executeDdl(executor, `
    CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_site_comment_id_idx`)}
    ON ${quoted(metaTable)} ("site_comment_id")
  `);
}

async function allocateSiteTableIndex(executor: SqlExecutor, siteId: string) {
  await ensureRegistryTable(executor);
  const existing = (await executor.execute(
    sql`SELECT "tableIndex" FROM ${sql.raw(quoted(registryTableName))} WHERE "siteId" = ${siteId} LIMIT 1`,
  )) as QueryRows<{ tableIndex?: number | string | null }>;
  const existingIndexRaw = existing.rows?.[0]?.tableIndex;
  const existingIndex =
    typeof existingIndexRaw === "number"
      ? existingIndexRaw
      : Number.parseInt(String(existingIndexRaw ?? "-1"), 10);
  if (Number.isFinite(existingIndex) && existingIndex >= 0) return existingIndex;

  const maxResult = (await executor.execute(
    sql.raw(`SELECT COALESCE(MAX("tableIndex"), -1) + 1 AS next_index FROM ${quoted(registryTableName)}`),
  )) as QueryRows<{ next_index?: number | string | null }>;
  const nextRaw = maxResult.rows?.[0]?.next_index;
  const nextIndex =
    typeof nextRaw === "number"
      ? nextRaw
      : Number.parseInt(String(nextRaw ?? "-1"), 10);
  const finalIndex = Number.isFinite(nextIndex) && nextIndex >= 0 ? nextIndex : 0;

  await executor.execute(sql`
    INSERT INTO ${sql.raw(quoted(registryTableName))} ("siteId", "tableIndex")
    VALUES (${siteId}, ${finalIndex})
    ON CONFLICT ("siteId") DO NOTHING
  `);

  const finalRows = (await executor.execute(
    sql`SELECT "tableIndex" FROM ${sql.raw(quoted(registryTableName))} WHERE "siteId" = ${siteId} LIMIT 1`,
  )) as QueryRows<{ tableIndex?: number | string | null }>;
  const finalRaw = finalRows.rows?.[0]?.tableIndex;
  const resolved =
    typeof finalRaw === "number"
      ? finalRaw
      : Number.parseInt(String(finalRaw ?? "-1"), 10);
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error("Unable to allocate site comment table index.");
  }
  return resolved;
}

export async function ensureSiteCommentTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const cached = siteCommentCache.get(normalizedSiteId);
  if (cached) {
    return {
      tableIndex: cached.tableIndex,
      commentsTable: cached.commentsTable,
      commentMetaTable: cached.commentMetaTable,
    };
  }
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, normalizedSiteId),
    columns: { id: true },
  });
  if (!site) throw new Error("Invalid site.");
  const inFlight = siteCommentInFlight.get(normalizedSiteId);
  if (inFlight) return inFlight;
  const run = db.transaction(async (tx) => {
    const lockKey = `${normalizedPrefix}site_comment_tables:${normalizedSiteId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const tableIndex = await allocateSiteTableIndex(tx, normalizedSiteId);
    await createPhysicalSiteCommentTables(tx, tableIndex);
    const commentsTable = commentsTableName(tableIndex);
    const commentMetaTable = commentMetaTableName(tableIndex);
    siteCommentCache.set(normalizedSiteId, { tableIndex, commentsTable, commentMetaTable });
    return {
      tableIndex,
      commentsTable,
      commentMetaTable,
    };
  });
  siteCommentInFlight.set(normalizedSiteId, run);
  return run.finally(() => {
    siteCommentInFlight.delete(normalizedSiteId);
  });
}
