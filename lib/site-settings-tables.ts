import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { sites } from "@/lib/schema";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const registryTableName = `${normalizedPrefix}site_settings_table_registry`;
const siteSettingsCache = new Map<string, { tableIndex: number; settingsTable: string }>();
const siteSettingsInFlight = new Map<string, Promise<{ siteId: string; tableIndex: number; settingsTable: string }>>();
let registryEnsured = false;
let registryEnsurePromise: Promise<void> | null = null;

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function settingsTableName(tableIndex: number) {
  return `${normalizedPrefix}site_${tableIndex}_settings`;
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

async function createPhysicalSiteSettingsTable(executor: SqlExecutor, tableIndex: number) {
  const table = settingsTableName(tableIndex);
  await executeDdl(executor, `
    CREATE TABLE IF NOT EXISTS ${quoted(table)} (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await executeDdl(executor, `
    CREATE INDEX IF NOT EXISTS ${quoted(`${table}_key_idx`)} ON ${quoted(table)} ("key")
  `);
}

async function allocateSiteTableIndex(executor: SqlExecutor, siteId: string) {
  await ensureRegistryTable(executor);
  const existing = (await executor.execute(
    sql`SELECT "tableIndex" FROM ${sql.raw(quoted(registryTableName))} WHERE "siteId" = ${siteId} LIMIT 1`,
  )) as QueryRows<{ tableIndex?: number | string | null }>;
  const existingRaw = existing.rows?.[0]?.tableIndex;
  const existingIndex =
    typeof existingRaw === "number" ? existingRaw : Number.parseInt(String(existingRaw ?? "-1"), 10);
  if (Number.isFinite(existingIndex) && existingIndex >= 0) return existingIndex;

  const maxResult = (await executor.execute(
    sql.raw(`SELECT COALESCE(MAX("tableIndex"), -1) + 1 AS next_index FROM ${quoted(registryTableName)}`),
  )) as QueryRows<{ next_index?: number | string | null }>;
  const nextRaw = maxResult.rows?.[0]?.next_index;
  const nextIndex =
    typeof nextRaw === "number" ? nextRaw : Number.parseInt(String(nextRaw ?? "-1"), 10);
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
    typeof finalRaw === "number" ? finalRaw : Number.parseInt(String(finalRaw ?? "-1"), 10);
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error("Unable to allocate site settings table index.");
  }
  return resolved;
}

export async function ensureSiteSettingsTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const cached = siteSettingsCache.get(normalizedSiteId);
  if (cached) {
    return {
      siteId: normalizedSiteId,
      tableIndex: cached.tableIndex,
      settingsTable: cached.settingsTable,
    };
  }
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, normalizedSiteId),
    columns: { id: true },
  });
  if (!site) throw new Error("Invalid site.");
  const inFlight = siteSettingsInFlight.get(normalizedSiteId);
  if (inFlight) return inFlight;
  const run = db.transaction(async (tx) => {
    const lockKey = `${normalizedPrefix}site_settings_tables:${normalizedSiteId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const tableIndex = await allocateSiteTableIndex(tx, normalizedSiteId);
    await createPhysicalSiteSettingsTable(tx, tableIndex);
    const settingsTable = settingsTableName(tableIndex);
    siteSettingsCache.set(normalizedSiteId, { tableIndex, settingsTable });
    return {
      siteId: normalizedSiteId,
      tableIndex,
      settingsTable,
    };
  });
  siteSettingsInFlight.set(normalizedSiteId, run);
  return run.finally(() => {
    siteSettingsInFlight.delete(normalizedSiteId);
  });
}

export async function listSiteSettingsRegistries() {
  await ensureRegistryTable(db);
  const rows = (await db.execute(
    sql`SELECT "siteId", "tableIndex" FROM ${sql.raw(quoted(registryTableName))} ORDER BY "tableIndex" ASC`,
  )) as QueryRows<{ siteId?: string; tableIndex?: number | string | null }>;
  return (rows.rows || [])
    .map((row) => {
      const siteId = String(row.siteId || "").trim();
      const tableIndexRaw = row.tableIndex;
      const tableIndex =
        typeof tableIndexRaw === "number"
          ? tableIndexRaw
          : Number.parseInt(String(tableIndexRaw ?? "-1"), 10);
      if (!siteId || !Number.isFinite(tableIndex) || tableIndex < 0) return null;
      return {
        siteId,
        tableIndex,
        settingsTable: settingsTableName(tableIndex),
      };
    })
    .filter((row): row is { siteId: string; tableIndex: number; settingsTable: string } => Boolean(row));
}
