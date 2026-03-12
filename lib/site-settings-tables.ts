import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { sites } from "@/lib/schema";
import { physicalObjectName, sitePhysicalTableName } from "@/lib/site-physical-table-name";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const siteSettingsCache = new Map<string, { settingsTable: string }>();
const siteSettingsInFlight = new Map<string, Promise<{ siteId: string; settingsTable: string }>>();
const siteSettingsEnsured = new Set<string>();

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function settingsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "settings");
}

type SqlExecutor = { execute: typeof db.execute };
type QueryRows<T> = { rows?: T[] };

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

async function createPhysicalSiteSettingsTable(executor: SqlExecutor, siteId: string) {
  const table = settingsTableName(siteId);
  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(table)} (
      "key" TEXT CONSTRAINT ${quoted(physicalObjectName(table, "pkey"))} PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  );
  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${table}_key_idx`)} ON ${quoted(table)} ("key")
  `,
  );
}

async function tableExistsWithExecutor(executor: SqlExecutor, tableName: string) {
  const result = (await executor.execute(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`,
  )) as QueryRows<{ table_name?: string | null }>;
  return Boolean(result?.rows?.[0]?.table_name);
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

export async function ensureSiteSettingsTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const cached = siteSettingsCache.get(normalizedSiteId);
  if (cached && siteSettingsEnsured.has(normalizedSiteId)) {
    const hasPhysicalTable = await tableExistsWithExecutor(db, cached.settingsTable);
    if (!hasPhysicalTable) {
      siteSettingsCache.delete(normalizedSiteId);
      siteSettingsEnsured.delete(normalizedSiteId);
    } else {
      return {
        siteId: normalizedSiteId,
        settingsTable: cached.settingsTable,
      };
    }
  }
  const inFlight = siteSettingsInFlight.get(normalizedSiteId);
  if (inFlight) return inFlight;
  const run = withLockRetry(() =>
    db.transaction(async (tx) => {
      const site = await tx.query.sites.findFirst({
        where: eq(sites.id, normalizedSiteId),
        columns: { id: true },
      });
      if (!site) throw new Error("Invalid site.");
      const lockKey = `${normalizedPrefix}site_settings_tables:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      await createPhysicalSiteSettingsTable(tx, normalizedSiteId);
      const settingsTable = settingsTableName(normalizedSiteId);
      if (!(await tableExistsWithExecutor(tx, settingsTable))) {
        await createPhysicalSiteSettingsTable(tx, normalizedSiteId);
      }
      return {
        siteId: normalizedSiteId,
        settingsTable,
      };
    }),
  );
  siteSettingsInFlight.set(normalizedSiteId, run);
  return run
    .then(async (resolved) => {
      if (!(await tableExistsWithExecutor(db, resolved.settingsTable))) {
        await createPhysicalSiteSettingsTable(db, normalizedSiteId);
      }
      siteSettingsCache.set(normalizedSiteId, { settingsTable: resolved.settingsTable });
      siteSettingsEnsured.add(normalizedSiteId);
      return resolved;
    })
    .finally(() => {
      siteSettingsInFlight.delete(normalizedSiteId);
    });
}

export async function listSiteSettingsRegistries() {
  const siteRows = await db.select({ siteId: sites.id }).from(sites);
  const results: Array<{ siteId: string; settingsTable: string }> = [];
  for (const row of siteRows) {
    const siteId = String(row.siteId || "").trim();
    if (!siteId) continue;
    const ensured = await ensureSiteSettingsTable(siteId);
    results.push({
      siteId,
      settingsTable: ensured.settingsTable,
    });
  }
  return results;
}
