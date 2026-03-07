import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { sitePhysicalTableName } from "@/lib/site-physical-table-name";
import { eq, sql } from "drizzle-orm";
import { findSiteDataDomainById, listSiteDataDomains } from "@/lib/site-data-domain-registry";

const DEFAULT_IMAGE_BLURHASH =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAhCAYAAACbffiEAAAACXBIWXMAABYlAAAWJQFJUiTwAAABfUlEQVR4nN3XyZLDIAwE0Pz/v3q3r55JDlSBplsIEI49h76k4opexCK/juP4eXjOT149f2Tf9ySPgcjCc7kdpBTgDPKByKK2bTPFEdMO0RDrusJ0wLRBGCIuelmWJAjkgPGDSIQEMBDCfA2CEPM80+Qwl0JkNxBimiaYGOTUlXYI60YoehzHJDEm7kxjV3whOQTD3AaCuhGKHoYhyb+CBMwjIAFz647kTqyapdV4enGINuDJMSScPmijSwjCaHeLcT77C7EC0C1ugaCTi2HYfAZANgj6Z9A8xY5eiYghDMNQBJNCWhASot0jGsSCUiHWZcSGQjaWWCDaGMOWnsCcn2QhVkRuxqqNxMSdUSElCDbp1hbNOsa6Ugxh7xXauF4DyM1m5BLtCylBXgaxvPXVwEoOBjeIFVODtW74oj1yBQah3E8tyz3SkpolKS9Geo9YMD1QJR1Go4oJkgO1pgbNZq0AOUPChyjvh7vlXaQa+X1UXwKxgHokB2XPxbX+AnijwIU4ahazAAAAAElFTkSuQmCC";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const ensureCache = new Map<string, { contentTable: string; metaTable: string }>();
const inFlight = new Map<string, Promise<{ contentTable: string; metaTable: string }>>();

type SqlExecutor = { execute?: typeof db.execute };
type QueryRows<T> = { rows?: T[] };

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

function normalizeDomainKey(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function domainContentSuffix(domainKey: string) {
  const normalizedKey = normalizeDomainKey(domainKey);
  if (!normalizedKey) throw new Error("domainKey is required.");
  return `domain_${normalizedKey}`;
}

function domainMetaSuffix(domainKey: string) {
  return `${domainContentSuffix(domainKey)}_meta`;
}

export function siteDomainTypeTableTemplate(domainKey: string) {
  return `${normalizedPrefix}site_{id}_${domainContentSuffix(domainKey)}`;
}

export function siteDomainTypeMetaTableTemplate(domainKey: string) {
  return `${normalizedPrefix}site_{id}_${domainMetaSuffix(domainKey)}`;
}

export function siteDomainTypeTableName(siteId: string, domainKey: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, domainContentSuffix(domainKey));
}

export function siteDomainTypeMetaTableName(siteId: string, domainKey: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, domainMetaSuffix(domainKey));
}

function isDuplicatePgTypeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; constraint?: string };
  return (
    candidate.code === "42710" ||
    (candidate.code === "23505" && candidate.constraint === "pg_type_typname_nsp_index")
  );
}

async function executeDdl(executor: SqlExecutor, statement: string) {
  if (typeof executor.execute !== "function") return;
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgTypeError(error)) return;
    throw error;
  }
}

async function createPhysicalSiteDomainTypeTables(executor: SqlExecutor, siteId: string, domainKey: string) {
  const contentTable = siteDomainTypeTableName(siteId, domainKey);
  const metaTable = siteDomainTypeMetaTableName(siteId, domainKey);
  const prefixedUsers = `${normalizedPrefix}network_users`;

  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(contentTable)} (
      "id" TEXT PRIMARY KEY,
      "title" TEXT,
      "description" TEXT,
      "content" TEXT,
      "password" TEXT NOT NULL DEFAULT '',
      "usePassword" BOOLEAN NOT NULL DEFAULT FALSE,
      "layout" TEXT,
      "slug" TEXT NOT NULL,
      "image" TEXT NOT NULL DEFAULT '',
      "imageBlurhash" TEXT NOT NULL DEFAULT '${DEFAULT_IMAGE_BLURHASH}',
      "published" BOOLEAN NOT NULL DEFAULT FALSE,
      "userId" TEXT REFERENCES ${quoted(prefixedUsers)}("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("slug")
    )
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${contentTable}_published_updated_idx`)}
    ON ${quoted(contentTable)} ("published", "updatedAt")
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${contentTable}_user_id_idx`)}
    ON ${quoted(contentTable)} ("userId")
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
      "id" BIGSERIAL PRIMARY KEY,
      "domainPostId" TEXT NOT NULL REFERENCES ${quoted(contentTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "key" TEXT NOT NULL,
      "value" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("domainPostId", "key")
    )
  `,
  );

  await executeDdl(
    executor,
    `
    CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_domain_post_id_idx`)}
    ON ${quoted(metaTable)} ("domainPostId")
  `,
  );
}

export async function ensureSiteDomainTypeTables(siteId: string, domainKey: string) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedDomainKey = normalizeDomainKey(domainKey);
  if (!normalizedSiteId) throw new Error("siteId is required.");
  if (!normalizedDomainKey) throw new Error("domainKey is required.");

  const cacheKey = `${normalizedSiteId}:${normalizedDomainKey}`;
  const cached = ensureCache.get(cacheKey);
  if (cached) return cached;

  const pending = inFlight.get(cacheKey);
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
    if (typeof db.execute === "function") {
      await resolveSiteForValidation();
      await createPhysicalSiteDomainTypeTables(db as SqlExecutor, normalizedSiteId, normalizedDomainKey);
    }
    const resolved = {
      contentTable: siteDomainTypeTableName(normalizedSiteId, normalizedDomainKey),
      metaTable: siteDomainTypeMetaTableName(normalizedSiteId, normalizedDomainKey),
    };
    ensureCache.set(cacheKey, resolved);
    return resolved;
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

      const advisoryKey = `${normalizedPrefix}site_domain_type_tables:${normalizedSiteId}:${normalizedDomainKey}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
      await createPhysicalSiteDomainTypeTables(tx, normalizedSiteId, normalizedDomainKey);

      const resolved = {
        contentTable: siteDomainTypeTableName(normalizedSiteId, normalizedDomainKey),
        metaTable: siteDomainTypeMetaTableName(normalizedSiteId, normalizedDomainKey),
      };
      ensureCache.set(cacheKey, resolved);
      return resolved;
    }),
  );

  inFlight.set(cacheKey, run);
  return run.finally(() => {
    inFlight.delete(cacheKey);
  });
}

export async function ensureSiteDomainTypeTablesForDomain(siteId: string, dataDomainId: number) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const row = await findSiteDataDomainById(normalizedSiteId, dataDomainId);
  if (!row?.key) throw new Error("Invalid data domain.");
  return ensureSiteDomainTypeTables(normalizedSiteId, row.key);
}

export async function ensureAllRegisteredSiteDomainTypeTables(input?: { siteId?: string }) {
  const normalizedSiteId = String(input?.siteId || "").trim();
  const created: Array<{ siteId: string; domainKey: string; contentTable: string; metaTable: string }> = [];
  const targetSiteIds = normalizedSiteId
    ? [normalizedSiteId]
    : (await db.select({ id: sites.id }).from(sites)).map((row) => String(row.id || "").trim()).filter(Boolean);
  for (const siteId of targetSiteIds) {
    const definitions = await listSiteDataDomains(siteId, { includeInactive: false });
    for (const definition of definitions) {
      const domainKey = normalizeDomainKey(definition.key);
      if (!domainKey) continue;
      const ensured = await ensureSiteDomainTypeTables(siteId, domainKey);
      created.push({
        siteId,
        domainKey,
        contentTable: ensured.contentTable,
        metaTable: ensured.metaTable,
      });
    }
  }
  return created;
}

export async function siteTableExists(tableName: string) {
  const result = (await db.execute(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`,
  )) as QueryRows<{ table_name?: string | null }>;
  return Boolean(result.rows?.[0]?.table_name);
}
