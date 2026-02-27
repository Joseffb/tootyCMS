import { eq, inArray, like, or, sql } from "drizzle-orm";
import db from "@/lib/db";
import { systemSettings } from "@/lib/schema";
import { ensureSiteSettingsTable, listSiteSettingsRegistries } from "@/lib/site-settings-tables";

let ensured = false;
let ensurePromise: Promise<void> | null = null;

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

async function ensureSettingsTables() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
  const p = prefix();
  const system = `${p}system_settings`;
  const sites = `${p}sites`;
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoted(system)} (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`SELECT 1 FROM ${quoted(sites)} LIMIT 1`)).catch(() => undefined);
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
  await ensureSettingsTables();
  const normalized = normalize(key);
  if (!normalized) return undefined;
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
}

export async function getSettingsByKeys(keys: string[]) {
  await ensureSettingsTables();
  const normalized = Array.from(new Set(keys.map(normalize).filter(Boolean)));
  const siteKeys = normalized.filter((key) => isSiteScopedKey(key));
  const systemKeys = normalized.filter((key) => !isSiteScopedKey(key));
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
}

export async function setSettingByKey(key: string, value: string) {
  await ensureSettingsTables();
  const normalized = normalize(key);
  if (!normalized) throw new Error("Setting key is required.");
  if (isSiteScopedKey(normalized)) {
    const parts = parseSiteScopedKeyParts(normalized);
    if (!parts) throw new Error("Invalid site-scoped setting key.");
    const info = await ensureSiteSettingsTable(parts.siteId);
    await db.execute(sql`
      INSERT INTO ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)} ("key", "value")
      VALUES (${parts.localKey}, ${value})
      ON CONFLICT ("key")
      DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
    `);
    return;
  }
  await db
    .insert(systemSettings)
    .values({ key: normalized, value })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value },
    });
}

export async function deleteSettingsByKeys(keys: string[]) {
  await ensureSettingsTables();
  const normalized = Array.from(new Set(keys.map(normalize).filter(Boolean)));
  const siteKeys = normalized.filter((key) => isSiteScopedKey(key));
  const systemKeys = normalized.filter((key) => !isSiteScopedKey(key));
  if (systemKeys.length > 0) {
    await db.delete(systemSettings).where(inArray(systemSettings.key, systemKeys));
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
      await db.execute(sql`
        DELETE FROM ${sql.raw(`"${info.settingsTable.replace(/"/g, "\"\"")}"`)}
        WHERE "key" IN (${sql.join(localKeys.map((k) => sql`${k}`), sql`,`)})
      `);
    }
  }
}

export async function listSettingsByLikePatterns(patterns: string[]) {
  await ensureSettingsTables();
  const normalized = patterns.map(normalize).filter(Boolean);
  if (normalized.length === 0) return [] as Array<{ key: string; value: string }>;

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
}
