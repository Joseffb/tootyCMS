import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { siteUserTableRegistry } from "@/lib/schema";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

function quoted(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function usersTableName(tableIndex: number) {
  return `${normalizedPrefix}site_${tableIndex}_users`;
}

function userMetaTableName(tableIndex: number) {
  return `${normalizedPrefix}site_${tableIndex}_user_meta`;
}

const siteRegistryTableName = `${normalizedPrefix}site_user_table_registry`;

async function ensureRegistryTable() {
  const prefixedSites = `${normalizedPrefix}sites`;
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoted(siteRegistryTableName)} (
      "siteId" TEXT PRIMARY KEY REFERENCES ${quoted(prefixedSites)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "tableIndex" INTEGER NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
}

type QueryRows<T> = { rows?: T[] };

async function createPhysicalSiteUserTables(tableIndex: number) {
  const usersTable = usersTableName(tableIndex);
  const metaTable = userMetaTableName(tableIndex);
  const prefixedUsers = `${normalizedPrefix}users`;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoted(usersTable)} (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES ${quoted(prefixedUsers)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      role TEXT NOT NULL DEFAULT 'author',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id)
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS ${quoted(`${usersTable}_user_id_idx`)} ON ${quoted(usersTable)} ("user_id")
  `));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
      id BIGSERIAL PRIMARY KEY,
      site_user_id BIGINT NOT NULL REFERENCES ${quoted(usersTable)}("id") ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (site_user_id, key)
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_site_user_id_idx`)} ON ${quoted(metaTable)} ("site_user_id")
  `));
}

async function allocateSiteTableIndex(siteId: string) {
  await ensureRegistryTable();
  const [existing] = await db
    .select({ tableIndex: siteUserTableRegistry.tableIndex })
    .from(siteUserTableRegistry)
    .where(eq(siteUserTableRegistry.siteId, siteId))
    .limit(1);
  if (existing) return existing.tableIndex;

  return db.transaction(async (tx) => {
    const [already] = await tx
      .select({ tableIndex: siteUserTableRegistry.tableIndex })
      .from(siteUserTableRegistry)
      .where(eq(siteUserTableRegistry.siteId, siteId))
      .limit(1);
    if (already) return already.tableIndex;

    const maxResult = (await tx.execute(
      sql.raw(`SELECT COALESCE(MAX("tableIndex"), -1) + 1 AS next_index FROM ${quoted(siteRegistryTableName)}`)
    )) as QueryRows<{ next_index?: number | string | null }>;
    const nextRaw = maxResult.rows?.[0]?.next_index;
    const nextIndex =
      typeof nextRaw === "number"
        ? nextRaw
        : Number.parseInt(String(nextRaw ?? "-1"), 10);

    const [inserted] = await tx
      .insert(siteUserTableRegistry)
      .values({ siteId, tableIndex: Number.isFinite(nextIndex) ? nextIndex : 0 })
      .onConflictDoNothing({ target: [siteUserTableRegistry.siteId] })
      .returning({ tableIndex: siteUserTableRegistry.tableIndex });

    if (inserted) return inserted.tableIndex;

    const [finalRow] = await tx
      .select({ tableIndex: siteUserTableRegistry.tableIndex })
      .from(siteUserTableRegistry)
      .where(eq(siteUserTableRegistry.siteId, siteId))
      .limit(1);
    if (!finalRow) {
      throw new Error("Unable to allocate site user table index.");
    }
    return finalRow.tableIndex;
  });
}

export async function ensureSiteUserTables(siteId: string) {
  const tableIndex = await allocateSiteTableIndex(siteId);
  await createPhysicalSiteUserTables(tableIndex);
  return {
    tableIndex,
    usersTable: usersTableName(tableIndex),
    userMetaTable: userMetaTableName(tableIndex),
  };
}

export async function upsertSiteUserRole(siteId: string, userId: string, role: string) {
  const info = await ensureSiteUserTables(siteId);
  await db.execute(sql`
    INSERT INTO ${sql.raw(quoted(info.usersTable))} ("user_id", "role", "is_active")
    VALUES (${userId}, ${role}, TRUE)
    ON CONFLICT ("user_id")
    DO UPDATE SET "role" = EXCLUDED."role", "is_active" = TRUE, "updated_at" = NOW()
  `);
}

export async function getSiteUserRole(siteId: string, userId: string) {
  await ensureRegistryTable();
  const [registry] = await db
    .select({ tableIndex: siteUserTableRegistry.tableIndex })
    .from(siteUserTableRegistry)
    .where(eq(siteUserTableRegistry.siteId, siteId))
    .limit(1);
  if (!registry) return null;

  const usersTable = usersTableName(registry.tableIndex);
  const result = (await db.execute(
    sql`SELECT "role", "is_active" FROM ${sql.raw(quoted(usersTable))} WHERE "user_id" = ${userId} LIMIT 1`
  )) as QueryRows<{ role?: string | null; is_active?: boolean | null }>;
  const row = result.rows?.[0];
  if (!row || row.is_active === false) return null;
  return String(row.role || "").trim().toLowerCase() || null;
}

export async function listSiteUsers(siteId: string) {
  await ensureRegistryTable();
  const [registry] = await db
    .select({ tableIndex: siteUserTableRegistry.tableIndex })
    .from(siteUserTableRegistry)
    .where(eq(siteUserTableRegistry.siteId, siteId))
    .limit(1);
  if (!registry) return [];

  const usersTable = usersTableName(registry.tableIndex);
  const result = (await db.execute(
    sql`SELECT "id", "user_id", "role", "is_active", "created_at", "updated_at" FROM ${sql.raw(quoted(usersTable))} ORDER BY "created_at" ASC`
  )) as QueryRows<{
    id: number;
    user_id: string;
    role: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>;

  return result.rows ?? [];
}

export async function listSiteIdsForUser(userId: string) {
  if (!userId) return [] as string[];
  await ensureRegistryTable();
  const registries = await db
    .select({
      siteId: siteUserTableRegistry.siteId,
      tableIndex: siteUserTableRegistry.tableIndex,
    })
    .from(siteUserTableRegistry);

  const allowedSiteIds: string[] = [];
  for (const entry of registries) {
    const usersTable = usersTableName(entry.tableIndex);
    const result = (await db.execute(
      sql`SELECT "user_id" FROM ${sql.raw(quoted(usersTable))} WHERE "user_id" = ${userId} AND "is_active" = TRUE LIMIT 1`
    )) as QueryRows<{ user_id?: string | null }>;
    if (result.rows?.[0]?.user_id) {
      allowedSiteIds.push(entry.siteId);
    }
  }
  return allowedSiteIds;
}
