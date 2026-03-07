import db from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { rbacRoles, users, sites } from "@/lib/schema";
import { sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
type SqlExecutor = { execute?: typeof db.execute };

function quoted(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
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

function usersTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "users");
}

function userMetaTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "user_meta");
}

function usersIdSequenceName(siteId: string) {
  return sitePhysicalSequenceName(normalizedPrefix, siteId, "users_id_seq");
}

function userMetaIdSequenceName(siteId: string) {
  return sitePhysicalSequenceName(normalizedPrefix, siteId, "user_meta_id_seq");
}

const siteUserTableCache = new Map<string, { usersTable: string; userMetaTable: string }>();
const siteUserTableInFlight = new Map<string, Promise<{ usersTable: string; userMetaTable: string }>>();

type QueryRows<T> = { rows?: T[] };

export function resetSiteUserTablesCache(siteId?: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (normalizedSiteId) {
    siteUserTableCache.delete(normalizedSiteId);
    siteUserTableInFlight.delete(normalizedSiteId);
    return;
  }
  siteUserTableCache.clear();
  siteUserTableInFlight.clear();
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

async function executeDdl(executor: SqlExecutor, statement: string) {
  if (typeof executor.execute !== "function") return;
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error) || isDuplicatePgRelationError(error)) return;
    throw error;
  }
}

async function relationExistsWithExecutor(executor: SqlExecutor, relationName: string) {
  const result = (await executor.execute?.(
    sql`SELECT to_regclass(${`public.${relationName}`}) AS relation_name`,
  )) as QueryRows<{ relation_name?: string | null }>;
  if (!result || !Array.isArray(result.rows)) {
    return true;
  }
  return Boolean(result.rows?.[0]?.relation_name);
}

async function waitForRelationVisible(executor: SqlExecutor, relationName: string, attempts = 10) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await relationExistsWithExecutor(executor, relationName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
  }
  return false;
}

function createPendingRelationRetryError(relationName: string) {
  return Object.assign(new Error(`Pending concurrent relation creation: ${relationName}`), { code: "55P03" });
}

function isMissingSiteUserTablesError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("_users") ||
    message.includes("_user_meta") ||
    message.includes("_users_id_seq") ||
    message.includes("_user_meta_id_seq") ||
    /relation ".*_users" does not exist/i.test(message) ||
    /relation ".*_user_meta" does not exist/i.test(message) ||
    /relation ".*_users_id_seq" does not exist/i.test(message) ||
    /relation ".*_user_meta_id_seq" does not exist/i.test(message)
  );
}

async function withSiteUserTableRecovery<T>(siteId: string, run: () => Promise<T>) {
  try {
    await ensureSiteUserTables(siteId);
    return await run();
  } catch (error) {
    if (!isMissingSiteUserTablesError(error)) throw error;
    resetSiteUserTablesCache(siteId);
    await ensureSiteUserTables(siteId);
    return run();
  }
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

async function createPhysicalSiteUserTables(executor: SqlExecutor, siteId: string) {
  const usersTable = usersTableName(siteId);
  const metaTable = userMetaTableName(siteId);
  const prefixedUsers = `${normalizedPrefix}network_users`;
  const usersIdSequence = usersIdSequenceName(siteId);
  const userMetaIdSequence = userMetaIdSequenceName(siteId);

  await createNamedRelation(
    executor,
    usersIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(usersIdSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    usersTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(usersTable)} (
        id BIGINT PRIMARY KEY DEFAULT nextval('${usersIdSequence}'),
        user_id TEXT NOT NULL REFERENCES ${quoted(prefixedUsers)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
        role TEXT NOT NULL DEFAULT 'author',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id)
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      ALTER TABLE ${quoted(usersTable)}
      ALTER COLUMN "id" SET DEFAULT nextval('${usersIdSequence}')
    `,
  );
  await executeDdl(
    executor,
    `
      ALTER SEQUENCE ${quoted(usersIdSequence)}
      OWNED BY ${quoted(usersTable)}."id"
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${usersTable}_user_id_idx`)} ON ${quoted(usersTable)} ("user_id")
    `,
  );

  await createNamedRelation(
    executor,
    userMetaIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(userMetaIdSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    metaTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
        id BIGINT PRIMARY KEY DEFAULT nextval('${userMetaIdSequence}'),
        site_user_id BIGINT NOT NULL REFERENCES ${quoted(usersTable)}("id") ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (site_user_id, key)
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      ALTER TABLE ${quoted(metaTable)}
      ALTER COLUMN "id" SET DEFAULT nextval('${userMetaIdSequence}')
    `,
  );
  await executeDdl(
    executor,
    `
      ALTER SEQUENCE ${quoted(userMetaIdSequence)}
      OWNED BY ${quoted(metaTable)}."id"
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_site_user_id_idx`)} ON ${quoted(metaTable)} ("site_user_id")
    `,
  );
}

async function siteUserTableExists(siteId: string) {
  return relationExistsWithExecutor(db, usersTableName(siteId));
}

export async function ensureSiteUserTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const cached = siteUserTableCache.get(normalizedSiteId);
  if (cached) {
    const usersTablePresent = await relationExistsWithExecutor(db, cached.usersTable);
    const userMetaTablePresent = await relationExistsWithExecutor(db, cached.userMetaTable);
    const usersSequencePresent = await relationExistsWithExecutor(db, usersIdSequenceName(normalizedSiteId));
    const userMetaSequencePresent = await relationExistsWithExecutor(db, userMetaIdSequenceName(normalizedSiteId));
    if (usersTablePresent && userMetaTablePresent && usersSequencePresent && userMetaSequencePresent) {
      return cached;
    }
  }
  const inFlight = siteUserTableInFlight.get(normalizedSiteId);
  if (inFlight) return inFlight;
  const run = withLockRetry(async () =>
    db.transaction(async (tx) => {
      const site = await tx.query.sites.findFirst({
        where: eq(sites.id, normalizedSiteId),
        columns: { id: true },
      });
      if (!site) throw new Error("Invalid site.");
      await createPhysicalSiteUserTables(tx, normalizedSiteId);
      const resolved = {
        usersTable: usersTableName(normalizedSiteId),
        userMetaTable: userMetaTableName(normalizedSiteId),
      };
      siteUserTableCache.set(normalizedSiteId, resolved);
      return resolved;
    }),
  );
  siteUserTableInFlight.set(normalizedSiteId, run);
  return run.finally(() => {
    siteUserTableInFlight.delete(normalizedSiteId);
  });
}

export async function upsertSiteUserRole(siteId: string, userId: string, role: string) {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  });
  if (!existingUser) return;

  await withSiteUserTableRecovery(siteId, async () => {
    const info = await ensureSiteUserTables(siteId);
    await db.execute(sql`
      INSERT INTO ${sql.raw(quoted(info.usersTable))} ("user_id", "role", "is_active")
      VALUES (${userId}, ${role}, TRUE)
      ON CONFLICT ("user_id")
      DO UPDATE SET "role" = EXCLUDED."role", "is_active" = TRUE, "updated_at" = NOW()
    `);
  });
}

export async function getSiteUserRole(siteId: string, userId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedSiteId || !normalizedUserId) return null;
  return withSiteUserTableRecovery(normalizedSiteId, async () => {
    const ensured = await ensureSiteUserTables(normalizedSiteId).catch(() => null);
    const usersTable = ensured?.usersTable || usersTableName(normalizedSiteId);
    if (!ensured && !(await siteUserTableExists(normalizedSiteId))) return null;
    const result = (await db.execute(
      sql`SELECT "role", "is_active" FROM ${sql.raw(quoted(usersTable))} WHERE "user_id" = ${normalizedUserId} LIMIT 1`,
    )) as QueryRows<{ role?: string | null; is_active?: boolean | null }>;
    const row = result.rows?.[0];
    if (!row || row.is_active === false) return null;
    return String(row.role || "").trim().toLowerCase() || null;
  });
}

export async function listSiteUsers(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return [];
  return withSiteUserTableRecovery(normalizedSiteId, async () => {
    const ensured = await ensureSiteUserTables(normalizedSiteId).catch(() => null);
    if (!ensured && !(await siteUserTableExists(normalizedSiteId))) return [];

    const usersTable = ensured?.usersTable || usersTableName(normalizedSiteId);
    const result = (await db.execute(
      sql`SELECT "id", "user_id", "role", "is_active", "created_at", "updated_at" FROM ${sql.raw(quoted(usersTable))} ORDER BY "created_at" ASC`,
    )) as QueryRows<{
      id: number;
      user_id: string;
      role: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>;

    return result.rows ?? [];
  });
}

export async function listSiteIdsForUser(userId: string) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return [] as string[];
  const siteRows = await db.select({ siteId: sites.id }).from(sites);
  const actor = await db.query.users.findFirst({
    where: eq(users.id, normalizedUserId),
    columns: { role: true },
  });
  const normalizedRole = String(actor?.role || "").trim().toLowerCase();
  if (normalizedRole) {
    try {
      const roleRow = await db.query.rbacRoles.findFirst({
        where: eq(rbacRoles.role, normalizedRole),
        columns: { capabilities: true },
      });
      const caps =
        roleRow?.capabilities && typeof roleRow.capabilities === "object"
          ? (roleRow.capabilities as Record<string, unknown>)
          : {};
      if (caps["network.site.manage"] === true) {
        return siteRows
          .map((row) => String(row.siteId || "").trim())
          .filter(Boolean);
      }
    } catch {
      // During setup/bootstrap, role tables can be in-flight; fall back to site memberships.
    }
    if (normalizedRole === "network admin") {
      return siteRows
        .map((row) => String(row.siteId || "").trim())
        .filter(Boolean);
    }
  }
  const allowedSiteIds: string[] = [];
  for (const siteRow of siteRows) {
    const siteId = String(siteRow.siteId || "").trim();
    if (!siteId) continue;
    const hasMembership = await withSiteUserTableRecovery(siteId, async () => {
      const ensured = await ensureSiteUserTables(siteId).catch(() => null);
      const usersTable = ensured?.usersTable || usersTableName(siteId);
      if (!ensured && !(await siteUserTableExists(siteId))) return false;
      const result = (await db.execute(
        sql`SELECT "user_id" FROM ${sql.raw(quoted(usersTable))} WHERE "user_id" = ${normalizedUserId} AND "is_active" = TRUE LIMIT 1`,
      )) as QueryRows<{ user_id?: string | null }>;
      return Boolean(result.rows?.[0]?.user_id);
    });
    if (hasMembership) {
      allowedSiteIds.push(siteId);
    }
  }
  return allowedSiteIds;
}
