import { eq, inArray, like, or, sql } from "drizzle-orm";
import db from "@/lib/db";
import { systemSettings } from "@/lib/schema";
import { ensureSiteSettingsTable, listSiteSettingsRegistries } from "@/lib/site-settings-tables";

let ensured = false;
let ensurePromise: Promise<void> | null = null;

type SqlExecutor = { execute: typeof db.execute };

function getTransientDbErrorDetails(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return { code, message };
}

function isTransientDbError(error: unknown) {
  const { code, message } = getTransientDbErrorDetails(error);
  if (code === "40P01" || code === "55P03" || code === "57P01" || code === "57P02" || code === "57P03") {
    return true;
  }
  if (code === "ECONNRESET" || code === "ETIMEDOUT") return true;
  return (
    message.includes("Connection terminated unexpectedly") ||
    message.includes("terminating connection due to administrator command") ||
    message.includes("Client has encountered a connection error and is not queryable")
  );
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

async function withWriteRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 125 * attempt));
    }
  }
  throw lastError;
}

async function withReadRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 125 * attempt));
    }
  }
  throw lastError;
}

function normalize(value: unknown) {
  return String(value || "").trim();
}

function parseSiteIdFromScopedKey(key: string) {
  const normalized = normalize(key);
  if (!normalized.startsWith("site_")) return "";
  const rest = normalized.slice("site_".length);
  const separator = rest.indexOf("_");
  if (separator <= 0) return "";
  return rest.slice(0, separator).trim();
}

function parseSiteScopedKeyParts(key: string): { siteId: string; localKey: string } | null {
  const normalized = normalize(key);
  if (!normalized.startsWith("site_")) return null;
  const rest = normalized.slice("site_".length);
  const separator = rest.indexOf("_");
  if (separator <= 0) return null;
  const siteId = rest.slice(0, separator).trim();
  const localKey = rest.slice(separator + 1).trim();
  if (!siteId || !localKey) return null;
  return { siteId, localKey };
}

function prefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function quoted(value: string) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

async function executeDdl(executor: SqlExecutor, statement: string) {
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error) || isDuplicatePgRelationError(error)) return;
    throw error;
  }
}

async function tableExistsWithExecutor(executor: SqlExecutor, tableName: string) {
  const result = (await executor.execute(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`,
  )) as { rows?: Array<{ table_name?: string | null }> };
  return Boolean(result?.rows?.[0]?.table_name);
}

async function waitForTableVisible(executor: SqlExecutor, tableName: string, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await tableExistsWithExecutor(executor, tableName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
  }
  return false;
}

async function ensureNetworkSystemSettingsTable(executor: SqlExecutor, tableName: string) {
  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(tableName)} (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  );

  if (await waitForTableVisible(executor, tableName)) return;

  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(tableName)} (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  );

  if (!(await waitForTableVisible(executor, tableName))) {
    throw new Error(`Failed to ensure settings table ${tableName}.`);
  }
}

async function ensureSettingsTables() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const p = prefix();
    const system = `${p}network_system_settings`;
    const sites = `${p}network_sites`;
    const lockKey = `${p}network_system_settings_bootstrap`;
    await withWriteRetry(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
        await ensureNetworkSystemSettingsTable(tx, system);
        await tx.execute(sql.raw(`SELECT 1 FROM ${quoted(sites)} LIMIT 1`)).catch(() => undefined);
      }),
    );
    if (!(await tableExistsWithExecutor(db, system))) {
      await ensureNetworkSystemSettingsTable(db, system);
    }
    ensured = true;
  })()
    .finally(() => {
      if (!ensured) ensurePromise = null;
    });
  return ensurePromise;
}

function isSiteScopedKey(key: string) {
  return parseSiteIdFromScopedKey(key).length > 0;
}

export async function getSettingByKey(key: string) {
  const normalized = normalize(key);
  if (!normalized) return undefined;
  return withReadRetry(async () => {
    await ensureSettingsTables();
    if (isSiteScopedKey(normalized)) {
      const parts = parseSiteScopedKeyParts(normalized);
      if (!parts) return undefined;
      const info = await ensureSiteSettingsTable(parts.siteId);
      const rows = (await db.execute(
        sql`SELECT "value" FROM ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)} WHERE "key" = ${parts.localKey} LIMIT 1`,
      )) as { rows?: Array<{ value?: string | null }> };
      return rows.rows?.[0]?.value || undefined;
    }
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, normalized),
      columns: { value: true },
    });
    return row?.value;
  });
}

export async function getSettingsByKeys(keys: string[]) {
  const normalized = Array.from(new Set(keys.map(normalize).filter(Boolean)));
  const siteKeys = normalized.filter((key) => isSiteScopedKey(key));
  const systemKeys = normalized.filter((key) => !isSiteScopedKey(key));
  return withReadRetry(async () => {
    await ensureSettingsTables();
    const out: Record<string, string> = {};

    if (systemKeys.length > 0) {
      const rows = await db
        .select({ key: systemSettings.key, value: systemSettings.value })
        .from(systemSettings)
        .where(inArray(systemSettings.key, systemKeys));
      for (const row of rows) out[row.key] = row.value;
    }

    if (siteKeys.length > 0) {
      const bySite = new Map<string, string[]>();
      for (const key of siteKeys) {
        const parts = parseSiteScopedKeyParts(key);
        if (!parts) continue;
        const list = bySite.get(parts.siteId) ?? [];
        list.push(parts.localKey);
        bySite.set(parts.siteId, list);
      }
      for (const [siteId, localKeys] of bySite.entries()) {
        const info = await ensureSiteSettingsTable(siteId);
        const rows = (await db.execute(
          sql`SELECT "key", "value" FROM ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)} WHERE "key" IN (${sql.join(localKeys.map((k) => sql`${k}`), sql`,`)})`,
        )) as { rows?: Array<{ key?: string | null; value?: string | null }> };
        for (const row of rows.rows || []) {
          const localKey = normalize(row.key);
          if (!localKey) continue;
          out[`site_${siteId}_${localKey}`] = String(row.value || "");
        }
      }
    }

    return out;
  });
}

export async function setSettingByKey(key: string, value: string) {
  await ensureSettingsTables();
  const normalized = normalize(key);
  if (!normalized) throw new Error("Setting key is required.");
  if (isSiteScopedKey(normalized)) {
    const parts = parseSiteScopedKeyParts(normalized);
    if (!parts) throw new Error("Invalid site-scoped setting key.");
    const info = await ensureSiteSettingsTable(parts.siteId);
    await withWriteRetry(() =>
      db.execute(sql`
        INSERT INTO ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)} ("key", "value")
        VALUES (${parts.localKey}, ${value})
        ON CONFLICT ("key")
        DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      `),
    );
    return;
  }
  await withWriteRetry(() =>
    db
      .insert(systemSettings)
      .values({ key: normalized, value })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value },
      }),
  );
}

export async function deleteSettingsByKeys(keys: string[]) {
  await ensureSettingsTables();
  const normalized = Array.from(new Set(keys.map(normalize).filter(Boolean)));
  const siteKeys = normalized.filter((key) => isSiteScopedKey(key));
  const systemKeys = normalized.filter((key) => !isSiteScopedKey(key));
  if (systemKeys.length > 0) {
    await withWriteRetry(() =>
      db.delete(systemSettings).where(inArray(systemSettings.key, systemKeys)),
    );
  }
  if (siteKeys.length > 0) {
    const bySite = new Map<string, string[]>();
    for (const key of siteKeys) {
      const parts = parseSiteScopedKeyParts(key);
      if (!parts) continue;
      const list = bySite.get(parts.siteId) ?? [];
      list.push(parts.localKey);
      bySite.set(parts.siteId, list);
    }
    for (const [siteId, localKeys] of bySite.entries()) {
      const info = await ensureSiteSettingsTable(siteId);
      await withWriteRetry(() =>
        db.execute(sql`
          DELETE FROM ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)}
          WHERE "key" IN (${sql.join(localKeys.map((k) => sql`${k}`), sql`,`)})
        `),
      );
    }
  }
}

export async function listSettingsByLikePatterns(patterns: string[]) {
  const normalized = patterns.map(normalize).filter(Boolean);
  if (normalized.length === 0) return [] as Array<{ key: string; value: string }>;

  return withReadRetry(async () => {
    await ensureSettingsTables();
    const sitePatterns = normalized.filter((pattern) => pattern.startsWith("site_"));
    const systemPatterns = normalized.filter((pattern) => !pattern.startsWith("site_"));
    const rows: Array<{ key: string; value: string }> = [];

    if (systemPatterns.length > 0) {
      const conditions = systemPatterns.map((pattern) => like(systemSettings.key, pattern));
      const found = await db
        .select({ key: systemSettings.key, value: systemSettings.value })
        .from(systemSettings)
        .where(or(...conditions));
      rows.push(...found);
    }

    if (sitePatterns.length > 0) {
      const registries = await listSiteSettingsRegistries();
      for (const registry of registries) {
        const localPatterns = sitePatterns
          .map((pattern) => {
            const parts = parseSiteScopedKeyParts(pattern.replace("%", `${registry.siteId}`));
            if (parts?.siteId === registry.siteId) return parts.localKey;
            if (pattern.startsWith(`site_${registry.siteId}_`)) {
              return pattern.slice(`site_${registry.siteId}_`.length);
            }
            if (pattern.startsWith("site_%_")) return pattern.slice("site_%_".length);
            return "";
          })
          .filter(Boolean);
        if (!localPatterns.length) continue;
        const whereSql = sql.join(localPatterns.map((pattern) => sql`"key" LIKE ${pattern}`), sql` OR `);
        const found = (await db.execute(sql`
          SELECT "key", "value"
          FROM ${sql.raw(`"${registry.settingsTable.replace(/"/g, "\"\"")}"`)}
          WHERE ${whereSql}
        `)) as { rows?: Array<{ key?: string | null; value?: string | null }> };
        for (const row of found.rows || []) {
          const localKey = normalize(row.key);
          if (!localKey) continue;
          rows.push({
            key: `site_${registry.siteId}_${localKey}`,
            value: String(row.value || ""),
          });
        }
      }
    }

    return rows;
  });
}
