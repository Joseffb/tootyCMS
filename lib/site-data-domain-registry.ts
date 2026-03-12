import db from "@/lib/db";
import { isMissingRelationError } from "@/lib/db-errors";
import { sites } from "@/lib/schema";
import { physicalObjectName, sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";
import { eq, sql } from "drizzle-orm";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const sitesTable = `${normalizedPrefix}sites`;
const siteTableCache = new Set<string>();
const siteTableInFlight = new Map<string, Promise<void>>();

export type SiteDataDomainRecord = {
  id: number;
  key: string;
  label: string;
  contentTable: string;
  metaTable: string;
  description: string;
  settings: Record<string, unknown>;
  isActive: boolean;
};

type QueryRows<T> = { rows?: T[] };
type SqlExecutor = { execute?: typeof db.execute };

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function isRetryablePgLockError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "40P01" || candidate.code === "55P03";
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

function isMissingSiteDataDomainRelationError(error: unknown) {
  if (!isMissingPgRelationError(error)) return false;
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return message.includes("_data_domains") || message.includes("_data_domains_id_seq");
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

function normalizeDomainKey(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function siteDomainsTable(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "data_domains");
}

function normalizeSettings(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizeRows<T>(result: unknown) {
  return ((result as QueryRows<T>)?.rows || []) as T[];
}

function isDuplicatePgTypeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return candidate.code === "23505" && candidate.constraint === "pg_type_typname_nsp_index";
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

async function tableExistsWithExecutor(executor: SqlExecutor, tableName: string) {
  if (typeof executor.execute !== "function") return true;
  const result = (await executor.execute(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`,
  )) as QueryRows<{ table_name?: string | null }>;
  if (!result || !Array.isArray(result.rows)) return true;
  return Boolean(result.rows[0]?.table_name);
}

function hasExpectedSequenceDefault(columnDefault: string, sequenceName: string) {
  const normalizedDefault = String(columnDefault || "").replace(/\s+/g, " ").trim();
  if (!normalizedDefault) return false;
  return normalizedDefault.includes("nextval(") && normalizedDefault.includes(sequenceName);
}

async function waitForRelationVisible(executor: SqlExecutor, relationName: string, attempts = 10) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await tableExistsWithExecutor(executor, relationName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
  }
  return false;
}

function createPendingRelationRetryError(relationName: string) {
  return Object.assign(new Error(`Pending concurrent relation creation: ${relationName}`), { code: "55P03" });
}

async function withSiteDataDomainTableRecovery<T>(siteId: string, run: () => Promise<T>) {
  try {
    await ensureSiteDataDomainTable(siteId);
    return await run();
  } catch (error) {
    if (!isMissingSiteDataDomainRelationError(error)) throw error;
    siteTableCache.delete(siteId);
    siteTableInFlight.delete(siteId);
    await ensureSiteDataDomainTable(siteId);
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

async function dataDomainIdDefaultNeedsRepair(executor: SqlExecutor, siteId: string) {
  if (typeof executor.execute !== "function") return false;
  const table = siteDomainsTable(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "data_domains_id_seq");
  const result = (await withLockRetry(() =>
    executor.execute!(
      sql`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND column_name = 'id'
      `,
    ).catch((error) => {
      if (isMissingPgRelationError(error)) {
        return { rows: [{ column_default: null }] } as QueryRows<{ column_default?: string | null }>;
      }
      throw error;
    }),
  )) as QueryRows<{ column_default?: string | null }>;
  if (!result || !Array.isArray(result.rows)) return false;
  const columnDefault = String(result.rows[0]?.column_default || "");
  return !hasExpectedSequenceDefault(columnDefault, idSequence);
}

async function ensurePhysicalSiteDataDomainColumns(executor: SqlExecutor, siteId: string) {
  const table = siteDomainsTable(siteId);
  const statements = [
    `
      ALTER TABLE ${quoted(table)}
      ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT ''
    `,
    `
      ALTER TABLE ${quoted(table)}
      ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}'::jsonb
    `,
    `
      ALTER TABLE ${quoted(table)}
      ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE
    `,
    `
      ALTER TABLE ${quoted(table)}
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `,
    `
      ALTER TABLE ${quoted(table)}
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `,
    `
      UPDATE ${quoted(table)}
      SET
        "description" = COALESCE("description", ''),
        "settings" = COALESCE("settings", '{}'::jsonb),
        "isActive" = COALESCE("isActive", TRUE),
        "createdAt" = COALESCE("createdAt", NOW()),
        "updatedAt" = COALESCE("updatedAt", NOW())
    `,
    `
      ALTER TABLE ${quoted(table)}
      ALTER COLUMN "description" SET DEFAULT '',
      ALTER COLUMN "description" SET NOT NULL,
      ALTER COLUMN "settings" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "settings" SET NOT NULL,
      ALTER COLUMN "isActive" SET DEFAULT TRUE,
      ALTER COLUMN "isActive" SET NOT NULL,
      ALTER COLUMN "createdAt" SET DEFAULT NOW(),
      ALTER COLUMN "createdAt" SET NOT NULL,
      ALTER COLUMN "updatedAt" SET DEFAULT NOW(),
      ALTER COLUMN "updatedAt" SET NOT NULL
    `,
  ];
  for (const statement of statements) {
    await executeDdl(executor, statement);
  }
}

async function createPhysicalSiteDataDomainTable(executor: SqlExecutor, siteId: string) {
  const table = siteDomainsTable(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "data_domains_id_seq");
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
        "id" INTEGER CONSTRAINT ${quoted(physicalObjectName(table, "pkey"))} PRIMARY KEY,
        "key" TEXT NOT NULL CONSTRAINT ${quoted(physicalObjectName(table, "key_key"))} UNIQUE,
        "label" TEXT NOT NULL,
        "contentTable" TEXT NOT NULL,
        "metaTable" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    { allowDuplicateType: true },
  );
  await repairDataDomainIdDefaultAndOwnership(executor, siteId);
  await ensurePhysicalSiteDataDomainColumns(executor, siteId);
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${table}_key_idx`)}
      ON ${quoted(table)} ("key")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${table}_is_active_idx`)}
      ON ${quoted(table)} ("isActive")
    `,
  );
}

async function ensureDataDomainIdSequence(executor: SqlExecutor, siteId: string) {
  const table = siteDomainsTable(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "data_domains_id_seq");
  await createNamedRelation(
    executor,
    idSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(idSequence)}
    `,
  );
  if (!(await tableExistsWithExecutor(executor, idSequence))) {
    throw createPendingRelationRetryError(idSequence);
  }
  if (!(await tableExistsWithExecutor(executor, table))) {
    throw createPendingRelationRetryError(table);
  }
}

async function repairDataDomainIdDefaultAndOwnership(executor: SqlExecutor, siteId: string) {
  const table = siteDomainsTable(siteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "data_domains_id_seq");
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

export async function ensureSiteDataDomainRegistry() {
  // No shared registry table: data domain definitions are strictly site-physical.
  return;
}

export async function ensureSiteDataDomainTable(siteId: string): Promise<void> {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const tableName = siteDomainsTable(normalizedSiteId);
  const idSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "data_domains_id_seq");
  if (siteTableCache.has(normalizedSiteId)) {
    const hasTable = await tableExistsWithExecutor(db as SqlExecutor, tableName);
    const hasSequence = await tableExistsWithExecutor(db as SqlExecutor, idSequence);
    if (hasTable && hasSequence) {
      if (await dataDomainIdDefaultNeedsRepair(db as SqlExecutor, normalizedSiteId)) {
        await withLockRetry(() =>
          db.transaction(async (tx) => {
            const lockKey = `${normalizedPrefix}site_data_domains:${normalizedSiteId}`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
            if (await dataDomainIdDefaultNeedsRepair(tx, normalizedSiteId)) {
              await repairDataDomainIdDefaultAndOwnership(tx, normalizedSiteId);
            }
          }),
        );
      }
      return;
    }
    siteTableCache.delete(normalizedSiteId);
  }
  if (
    (await tableExistsWithExecutor(db as SqlExecutor, tableName)) &&
    (await tableExistsWithExecutor(db as SqlExecutor, idSequence))
  ) {
    if (await dataDomainIdDefaultNeedsRepair(db as SqlExecutor, normalizedSiteId)) {
      await withLockRetry(() =>
        db.transaction(async (tx) => {
          const lockKey = `${normalizedPrefix}site_data_domains:${normalizedSiteId}`;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
          if (await dataDomainIdDefaultNeedsRepair(tx, normalizedSiteId)) {
            await repairDataDomainIdDefaultAndOwnership(tx, normalizedSiteId);
          }
        }),
      );
    }
    siteTableCache.add(normalizedSiteId);
    return;
  }
  const pending = siteTableInFlight.get(normalizedSiteId);
  if (pending) return pending;

  const resolveSiteForValidation = async () => {
    let siteLookupPerformed = false;
    let site: unknown = null;
    if (typeof db.query?.sites?.findFirst === "function") {
      siteLookupPerformed = true;
      site = await db.query.sites.findFirst({
        where: eq(sites.id, normalizedSiteId),
        columns: { id: true },
      });
    }
    if (siteLookupPerformed && !site) throw new Error("Invalid site.");
  };

  if (typeof db.transaction !== "function") {
    await resolveSiteForValidation();
    await createPhysicalSiteDataDomainTable(db as SqlExecutor, normalizedSiteId);
    await ensureDataDomainIdSequence(db as SqlExecutor, normalizedSiteId);
    await repairDataDomainIdDefaultAndOwnership(db as SqlExecutor, normalizedSiteId);
    siteTableCache.add(normalizedSiteId);
    return;
  }

  const run = withLockRetry(() =>
    db.transaction(async (tx) => {
      let siteLookupPerformed = false;
      let site: unknown = null;
      if (typeof tx.query?.sites?.findFirst === "function") {
        siteLookupPerformed = true;
        site = await tx.query.sites.findFirst({
          where: eq(sites.id, normalizedSiteId),
          columns: { id: true },
        });
      } else if (typeof db.query?.sites?.findFirst === "function") {
        siteLookupPerformed = true;
        site = await db.query.sites.findFirst({
          where: eq(sites.id, normalizedSiteId),
          columns: { id: true },
        });
      }
      if (siteLookupPerformed && !site) throw new Error("Invalid site.");

      const lockKey = `${normalizedPrefix}site_data_domains:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      await createPhysicalSiteDataDomainTable(tx, normalizedSiteId);
      await ensureDataDomainIdSequence(tx, normalizedSiteId);
      await repairDataDomainIdDefaultAndOwnership(tx, normalizedSiteId);
      if (!(await tableExistsWithExecutor(tx, tableName)) || !(await tableExistsWithExecutor(tx, idSequence))) {
        await createPhysicalSiteDataDomainTable(tx, normalizedSiteId);
        await ensureDataDomainIdSequence(tx, normalizedSiteId);
        await repairDataDomainIdDefaultAndOwnership(tx, normalizedSiteId);
      }
      siteTableCache.add(normalizedSiteId);
    }),
  );

  siteTableInFlight.set(normalizedSiteId, run);
  return run
    .then(async () => {
      if (
        !(await tableExistsWithExecutor(db as SqlExecutor, tableName)) ||
        !(await tableExistsWithExecutor(db as SqlExecutor, idSequence))
      ) {
        await createPhysicalSiteDataDomainTable(db as SqlExecutor, normalizedSiteId);
        await ensureDataDomainIdSequence(db as SqlExecutor, normalizedSiteId);
        await repairDataDomainIdDefaultAndOwnership(db as SqlExecutor, normalizedSiteId);
      }
      if (await dataDomainIdDefaultNeedsRepair(db as SqlExecutor, normalizedSiteId)) {
        await createPhysicalSiteDataDomainTable(db as SqlExecutor, normalizedSiteId);
        await ensureDataDomainIdSequence(db as SqlExecutor, normalizedSiteId);
        await repairDataDomainIdDefaultAndOwnership(db as SqlExecutor, normalizedSiteId);
      }
    })
    .catch(async (error) => {
      if (!isMissingSiteDataDomainRelationError(error)) throw error;
      siteTableCache.delete(normalizedSiteId);
      siteTableInFlight.delete(normalizedSiteId);
      return ensureSiteDataDomainTable(normalizedSiteId);
    })
    .finally(() => {
      siteTableInFlight.delete(normalizedSiteId);
    });
}

export async function listSiteDataDomains(siteId: string, options?: { includeInactive?: boolean }) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return [] as SiteDataDomainRecord[];
  const table = siteDomainsTable(normalizedSiteId);
  const result = await withSiteDataDomainTableRecovery(normalizedSiteId, () =>
    withLockRetry(() =>
      db.execute(sql`
        SELECT
          "id",
          "key",
          "label",
          "contentTable",
          "metaTable",
          "description",
          "settings",
          "isActive"
        FROM ${sql.raw(quoted(table))}
        ORDER BY "id" ASC
      `),
    ),
  );
  const rows = normalizeRows<{
    id: number | string;
    key: string;
    label: string;
    contentTable: string;
    metaTable: string;
    description: string | null;
    settings: unknown;
    isActive: boolean | null;
  }>(result).map((row) => ({
    id: Number(row.id),
    key: String(row.key || "").trim(),
    label: String(row.label || row.key || "").trim(),
    contentTable: String(row.contentTable || "").trim(),
    metaTable: String(row.metaTable || "").trim(),
    description: String(row.description || "").trim(),
    settings: normalizeSettings(row.settings),
    isActive: row.isActive !== false,
  }));
  if (options?.includeInactive) return rows;
  return rows.filter((row) => row.isActive);
}

export async function findSiteDataDomainByKey(siteId: string, domainKey: string) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  if (!normalizedSiteId || !normalizedDomainKey) return null;
  const table = siteDomainsTable(normalizedSiteId);
  const result = await withSiteDataDomainTableRecovery(normalizedSiteId, () =>
    withLockRetry(() =>
      db.execute(sql`
        SELECT
          "id",
          "key",
          "label",
          "contentTable",
          "metaTable",
          "description",
          "settings",
          "isActive"
        FROM ${sql.raw(quoted(table))}
        WHERE "key" = ${normalizedDomainKey}
        LIMIT 1
      `),
    ),
  );
  const row = normalizeRows<{
    id: number | string;
    key: string;
    label: string;
    contentTable: string;
    metaTable: string;
    description: string | null;
    settings: unknown;
    isActive: boolean | null;
  }>(result)[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    key: String(row.key || "").trim(),
    label: String(row.label || row.key || "").trim(),
    contentTable: String(row.contentTable || "").trim(),
    metaTable: String(row.metaTable || "").trim(),
    description: String(row.description || "").trim(),
    settings: normalizeSettings(row.settings),
    isActive: row.isActive !== false,
  } as SiteDataDomainRecord;
}

export async function findSiteDataDomainById(siteId: string, dataDomainId: number) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedId = Number(dataDomainId || 0);
  if (!normalizedSiteId || !Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const rows = await listSiteDataDomains(normalizedSiteId, { includeInactive: true });
  return rows.find((row) => row.id === normalizedId) || null;
}

export async function upsertSiteDataDomain(
  siteId: string,
  input: {
    key: string;
    label: string;
    contentTable: string;
    metaTable: string;
    description?: string;
    settings?: Record<string, unknown>;
    isActive?: boolean;
  },
) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(input.key);
  if (!normalizedSiteId) throw new Error("siteId is required.");
  if (!normalizedDomainKey) throw new Error("domain key is required.");
  await ensureSiteDataDomainTable(normalizedSiteId);

  const table = siteDomainsTable(normalizedSiteId);
  const description = String(input.description || "").trim();
  const isActive = input.isActive !== false;
  const settings = input.settings || {};

  const result = await withLockRetry(() =>
    db.execute(sql`
      INSERT INTO ${sql.raw(quoted(table))}
        ("key", "label", "contentTable", "metaTable", "description", "settings", "isActive")
      VALUES (
        ${normalizedDomainKey},
        ${String(input.label || normalizedDomainKey)},
        ${String(input.contentTable || "")},
        ${String(input.metaTable || "")},
        ${description},
        ${JSON.stringify(settings)}::jsonb,
        ${isActive}
      )
      ON CONFLICT ("key")
      DO UPDATE SET
        "label" = EXCLUDED."label",
        "contentTable" = EXCLUDED."contentTable",
        "metaTable" = EXCLUDED."metaTable",
        "description" = EXCLUDED."description",
        "settings" = EXCLUDED."settings",
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = NOW()
      RETURNING "id", "key", "label", "contentTable", "metaTable", "description", "settings", "isActive"
    `),
  );
  const row = normalizeRows<{
    id: number | string;
    key: string;
    label: string;
    contentTable: string;
    metaTable: string;
    description: string | null;
    settings: unknown;
    isActive: boolean | null;
  }>(result)[0];
  if (!row) {
    throw new Error("Failed to upsert site data domain.");
  }
  return {
    id: Number(row.id),
    key: String(row.key || "").trim(),
    label: String(row.label || row.key || "").trim(),
    contentTable: String(row.contentTable || "").trim(),
    metaTable: String(row.metaTable || "").trim(),
    description: String(row.description || "").trim(),
    settings: normalizeSettings(row.settings),
    isActive: row.isActive !== false,
  } as SiteDataDomainRecord;
}

export async function setSiteDataDomainActivation(siteId: string, domainKey: string, isActive: boolean) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  if (!normalizedSiteId || !normalizedDomainKey) return;
  await ensureSiteDataDomainTable(normalizedSiteId);
  const table = siteDomainsTable(normalizedSiteId);
  await withLockRetry(() =>
    db.execute(sql`
      UPDATE ${sql.raw(quoted(table))}
      SET "isActive" = ${isActive}, "updatedAt" = NOW()
      WHERE "key" = ${normalizedDomainKey}
    `),
  );
}

export async function deleteSiteDataDomainByKey(siteId: string, domainKey: string) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  if (!normalizedSiteId || !normalizedDomainKey) return;
  await ensureSiteDataDomainTable(normalizedSiteId);
  const table = siteDomainsTable(normalizedSiteId);
  await withLockRetry(() =>
    db.execute(sql`
      DELETE FROM ${sql.raw(quoted(table))}
      WHERE "key" = ${normalizedDomainKey}
    `),
  );
}

export async function updateSiteDataDomainById(
  siteId: string,
  dataDomainId: number,
  patch: {
    key?: string;
    label?: string;
    contentTable?: string;
    metaTable?: string;
    description?: string;
    settings?: Record<string, unknown>;
    isActive?: boolean;
  },
) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedId = Number(dataDomainId || 0);
  if (!normalizedSiteId || !Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  await ensureSiteDataDomainTable(normalizedSiteId);
  const existing = await findSiteDataDomainById(normalizedSiteId, normalizedId);
  if (!existing) return null;
  const nextKey = normalizeDomainKey(String(patch.key || existing.key));
  if (!nextKey) return null;
  const nextLabel = String(patch.label || existing.label || nextKey).trim();
  const nextDescription = String(patch.description ?? existing.description ?? "").trim();
  const nextContentTable = String(patch.contentTable || existing.contentTable || "").trim();
  const nextMetaTable = String(patch.metaTable || existing.metaTable || "").trim();
  const nextSettings =
    patch.settings && typeof patch.settings === "object"
      ? patch.settings
      : (existing.settings as Record<string, unknown>);
  const isActive = patch.isActive !== undefined ? Boolean(patch.isActive) : existing.isActive !== false;

  const table = siteDomainsTable(normalizedSiteId);
  const result = await withLockRetry(() =>
    db.execute(sql`
      UPDATE ${sql.raw(quoted(table))}
      SET
        "key" = ${nextKey},
        "label" = ${nextLabel},
        "contentTable" = ${nextContentTable},
        "metaTable" = ${nextMetaTable},
        "description" = ${nextDescription},
        "settings" = ${JSON.stringify(nextSettings)}::jsonb,
        "isActive" = ${isActive},
        "updatedAt" = NOW()
      WHERE "id" = ${normalizedId}
      RETURNING "id", "key", "label", "contentTable", "metaTable", "description", "settings", "isActive"
    `),
  );
  const row = normalizeRows<{
    id: number | string;
    key: string;
    label: string;
    contentTable: string;
    metaTable: string;
    description: string | null;
    settings: unknown;
    isActive: boolean | null;
  }>(result)[0];
  if (!row) return null;

  return {
    id: Number(row.id),
    key: String(row.key || "").trim(),
    label: String(row.label || row.key || "").trim(),
    contentTable: String(row.contentTable || "").trim(),
    metaTable: String(row.metaTable || "").trim(),
    description: String(row.description || "").trim(),
    settings: normalizeSettings(row.settings),
    isActive: row.isActive !== false,
  } as SiteDataDomainRecord;
}

export async function deleteSiteDataDomainById(siteId: string, dataDomainId: number) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedId = Number(dataDomainId || 0);
  if (!normalizedSiteId || !Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const row = await findSiteDataDomainById(normalizedSiteId, normalizedId);
  if (!row) return null;
  await deleteSiteDataDomainByKey(normalizedSiteId, row.key);
  return row;
}

export async function listSiteIdsWithDataDomain(domainKey: string) {
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  if (!normalizedDomainKey) return [] as string[];
  const siteRows = await db.select({ siteId: sites.id }).from(sites);
  const siteIds: string[] = [];
  for (const row of siteRows) {
    const siteId = String(row.siteId || "").trim();
    if (!siteId) continue;
    try {
      await ensureSiteDataDomainTable(siteId);
      const table = siteDomainsTable(siteId);
      const result = await withLockRetry(() =>
        db.execute(sql`
          SELECT "id"
          FROM ${sql.raw(quoted(table))}
          WHERE "key" = ${normalizedDomainKey}
            AND "isActive" = TRUE
          LIMIT 1
        `),
      );
      if (normalizeRows<{ id: number | string }>(result)[0]?.id) {
        siteIds.push(siteId);
      }
    } catch (error) {
      if (isMissingRelationError(error)) continue;
      throw error;
    }
  }
  return siteIds;
}
