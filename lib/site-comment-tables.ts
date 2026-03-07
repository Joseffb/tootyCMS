import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { sitePhysicalTableName } from "@/lib/site-physical-table-name";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const siteCommentCache = new Map<string, { commentsTable: string; commentMetaTable: string }>();
const siteCommentInFlight = new Map<string, Promise<{ commentsTable: string; commentMetaTable: string }>>();
const siteCommentEnsured = new Set<string>();

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function commentsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "comments");
}

function commentMetaTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "comment_meta");
}

type SqlExecutor = { execute: typeof db.execute };
function isDuplicatePgTypeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate.code === "42710" ||
    (candidate.code === "23505" && candidate.constraint === "pg_type_typname_nsp_index")
  );
}

function isRetryablePgLockError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "40P01" || candidate.code === "55P03";
}

async function executeDdl(executor: SqlExecutor, statement: string) {
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error)) return;
    throw error;
  }
}

async function createPhysicalSiteCommentTables(executor: SqlExecutor, siteId: string) {
  const commentsTable = commentsTableName(siteId);
  const metaTable = commentMetaTableName(siteId);
  const prefixedUsers = `${normalizedPrefix}network_users`;

  await executeDdl(
    executor,
    `
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
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_context_idx`)}
    ON ${quoted(commentsTable)} ("context_type", "context_id")
  `,
  );
  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_status_idx`)}
    ON ${quoted(commentsTable)} ("status")
  `,
  );
  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${commentsTable}_author_idx`)}
    ON ${quoted(commentsTable)} ("author_id")
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
      id BIGSERIAL PRIMARY KEY,
      site_comment_id TEXT NOT NULL REFERENCES ${quoted(commentsTable)}("id") ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (site_comment_id, key)
    )
  `,
  );
  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_site_comment_id_idx`)}
    ON ${quoted(metaTable)} ("site_comment_id")
  `,
  );
}

type QueryRows<T> = { rows?: T[] };

async function tableExistsWithExecutor(executor: SqlExecutor, tableName: string) {
  const result = (await executor.execute(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`,
  )) as QueryRows<{ table_name?: string | null }>;
  return Boolean(result.rows?.[0]?.table_name);
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

export async function ensureSiteCommentTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const cached = siteCommentCache.get(normalizedSiteId);
  if (cached && siteCommentEnsured.has(normalizedSiteId)) {
    const hasCommentsTable = await tableExistsWithExecutor(db, cached.commentsTable);
    const hasCommentMetaTable = await tableExistsWithExecutor(db, cached.commentMetaTable);
    if (!hasCommentsTable || !hasCommentMetaTable) {
      siteCommentCache.delete(normalizedSiteId);
      siteCommentEnsured.delete(normalizedSiteId);
    } else {
      return {
        commentsTable: cached.commentsTable,
        commentMetaTable: cached.commentMetaTable,
      };
    }
  }
  const inFlight = siteCommentInFlight.get(normalizedSiteId);
  if (inFlight) return inFlight;
  const run = withLockRetry(() =>
    db.transaction(async (tx) => {
      const site = await tx.query.sites.findFirst({
        where: eq(sites.id, normalizedSiteId),
        columns: { id: true },
      });
      if (!site) throw new Error("Invalid site.");
      const lockKey = `${normalizedPrefix}site_comment_tables:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      await createPhysicalSiteCommentTables(tx, normalizedSiteId);
      const commentsTable = commentsTableName(normalizedSiteId);
      const commentMetaTable = commentMetaTableName(normalizedSiteId);
      if (!(await tableExistsWithExecutor(tx, commentsTable))) {
        await createPhysicalSiteCommentTables(tx, normalizedSiteId);
      }
      if (!(await tableExistsWithExecutor(tx, commentMetaTable))) {
        await createPhysicalSiteCommentTables(tx, normalizedSiteId);
      }
      return {
        commentsTable,
        commentMetaTable,
      };
    }),
  );
  siteCommentInFlight.set(normalizedSiteId, run);
  return run
    .then(async (resolved) => {
      if (!(await tableExistsWithExecutor(db, resolved.commentsTable))) {
        await createPhysicalSiteCommentTables(db, normalizedSiteId);
      }
      if (!(await tableExistsWithExecutor(db, resolved.commentMetaTable))) {
        await createPhysicalSiteCommentTables(db, normalizedSiteId);
      }
      siteCommentCache.set(normalizedSiteId, {
        commentsTable: resolved.commentsTable,
        commentMetaTable: resolved.commentMetaTable,
      });
      siteCommentEnsured.add(normalizedSiteId);
      return {
        commentsTable: resolved.commentsTable,
        commentMetaTable: resolved.commentMetaTable,
      };
    })
    .finally(() => {
      siteCommentInFlight.delete(normalizedSiteId);
    });
}
