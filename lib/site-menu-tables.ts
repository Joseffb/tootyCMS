import db from "@/lib/db";
import { createId } from "@paralleldrive/cuid2";
import { sites } from "@/lib/schema";
import { physicalObjectName, sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";
import { ensureSiteMediaTable } from "@/lib/site-media-tables";
import { eq, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

type SqlExecutor = { execute?: typeof db.execute };

const ensureCache = new Map<
  string,
  {
    menusTable: ReturnType<typeof createMenusTable>;
    menuItemsTable: ReturnType<typeof createMenuItemsTable>;
    menuItemMetaTable: ReturnType<typeof createMenuItemMetaTable>;
  }
>();
const ensureInFlight = new Map<string, Promise<ReturnType<typeof getSiteMenuTables>>>();
const ensuredSites = new Set<string>();

export function resetSiteMenuTablesCache(siteId?: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    ensureCache.clear();
    ensureInFlight.clear();
    ensuredSites.clear();
    return;
  }
  ensureCache.delete(normalizedSiteId);
  ensureInFlight.delete(normalizedSiteId);
  ensuredSites.delete(normalizedSiteId);
}

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

export function siteMenusTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "menus");
}

export function siteMenuItemsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "menu_items");
}

export function siteMenuItemMetaTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "menu_item_meta");
}

function createMenusTable(siteId: string) {
  return pgTable(
    siteMenusTableName(siteId),
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => createId()),
      key: text("key").notNull(),
      title: text("title").notNull(),
      description: text("description").notNull().default(""),
      location: text("location"),
      sortOrder: integer("sortOrder").notNull().default(10),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      keyUnique: uniqueIndex().on(table.key),
      locationIdx: index().on(table.location),
      orderIdx: index().on(table.sortOrder),
    }),
  );
}

function createMenuItemsTable(siteId: string) {
  return pgTable(
    siteMenuItemsTableName(siteId),
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => createId()),
      menuId: text("menuId").notNull(),
      parentId: text("parentId"),
      title: text("title").notNull(),
      href: text("href").notNull(),
      description: text("description").notNull().default(""),
      mediaId: integer("mediaId"),
      target: text("target"),
      rel: text("rel"),
      external: boolean("external").notNull().default(false),
      enabled: boolean("enabled").notNull().default(true),
      sortOrder: integer("sortOrder").notNull().default(10),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      menuIdx: index().on(table.menuId),
      parentIdx: index().on(table.parentId),
      orderIdx: index().on(table.menuId, table.sortOrder),
      mediaIdx: index().on(table.mediaId),
    }),
  );
}

function createMenuItemMetaTable(siteId: string) {
  return pgTable(
    siteMenuItemMetaTableName(siteId),
    {
      id: serial("id").primaryKey(),
      menuItemId: text("menuItemId").notNull(),
      key: text("key").notNull(),
      value: text("value").notNull().default(""),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      menuItemKeyUnique: uniqueIndex().on(table.menuItemId, table.key),
      menuItemIdx: index().on(table.menuItemId),
    }),
  );
}

export function getSiteMenuTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required.");
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) return cached;
  const tables = {
    menusTable: createMenusTable(normalizedSiteId),
    menuItemsTable: createMenuItemsTable(normalizedSiteId),
    menuItemMetaTable: createMenuItemMetaTable(normalizedSiteId),
  };
  ensureCache.set(normalizedSiteId, tables);
  return tables;
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

function isMissingPgRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "42P01";
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

type QueryRows<T> = { rows?: T[] };

function hasExpectedSequenceDefault(columnDefault: string, sequenceName: string) {
  const normalizedDefault = String(columnDefault || "").replace(/\s+/g, " ").trim();
  if (!normalizedDefault) return false;
  return normalizedDefault.includes("nextval(") && normalizedDefault.includes(sequenceName);
}

async function relationExistsWithExecutor(executor: SqlExecutor, relationName: string) {
  const result = (await executor.execute?.(
    sql`SELECT to_regclass(${`public.${relationName}`}) AS relation_name`,
  )) as QueryRows<{ relation_name?: string | null }>;
  if (!result || !Array.isArray(result.rows)) {
    return true;
  }
  return Boolean(result?.rows?.[0]?.relation_name);
}

export async function siteMenuTablesReady(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const menusTable = siteMenusTableName(normalizedSiteId);
  const itemsTable = siteMenuItemsTableName(normalizedSiteId);
  const metaTable = siteMenuItemMetaTableName(normalizedSiteId);
  const [hasMenusTable, hasItemsTable, hasMetaTable] = await Promise.all([
    relationExistsWithExecutor(db, menusTable),
    relationExistsWithExecutor(db, itemsTable),
    relationExistsWithExecutor(db, metaTable),
  ]);
  return hasMenusTable && hasItemsTable && hasMetaTable;
}

async function waitForRelationVisible(executor: SqlExecutor, relationName: string, attempts = 10) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await relationExistsWithExecutor(executor, relationName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
  }
  return false;
}

async function menuMetaIdDefaultNeedsRepair(executor: SqlExecutor, siteId: string) {
  const metaTable = siteMenuItemMetaTableName(siteId);
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "menu_item_meta_id_seq");
  const result = (await executor.execute?.(sql`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${metaTable}
      AND column_name = 'id'
  `).catch((error) => {
    if (isMissingPgRelationError(error)) {
      return { rows: [{ column_default: null }] } as QueryRows<{ column_default?: string | null }>;
    }
    throw error;
  })) as QueryRows<{ column_default?: string | null }>;
  const columnDefault = String(result?.rows?.[0]?.column_default || "");
  return !hasExpectedSequenceDefault(columnDefault, metaIdSequence);
}

function createPendingRelationRetryError(relationName: string) {
  return Object.assign(new Error(`Pending concurrent relation creation: ${relationName}`), { code: "55P03" });
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

async function createPhysicalSiteMenuTables(executor: SqlExecutor, siteId: string) {
  const menusTable = siteMenusTableName(siteId);
  const itemsTable = siteMenuItemsTableName(siteId);
  const metaTable = siteMenuItemMetaTableName(siteId);
  const mediaTable = sitePhysicalTableName(normalizedPrefix, siteId, "media");
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "menu_item_meta_id_seq");
  const menusPrimaryKey = physicalObjectName(menusTable, "pkey");
  const menusKeyUnique = physicalObjectName(menusTable, "key_key");
  const itemsPrimaryKey = physicalObjectName(itemsTable, "pkey");
  const itemsMenuForeignKey = physicalObjectName(itemsTable, "menu_id_fkey");
  const itemsMediaForeignKey = physicalObjectName(itemsTable, "media_id_fkey");
  const metaPrimaryKey = physicalObjectName(metaTable, "pkey");
  const metaMenuItemForeignKey = physicalObjectName(metaTable, "menu_item_id_fkey");
  const metaMenuItemKeyUnique = physicalObjectName(metaTable, "menu_item_id_key_key");

  await createNamedRelation(
    executor,
    menusTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(menusTable)} (
        "id" TEXT CONSTRAINT ${quoted(menusPrimaryKey)} PRIMARY KEY,
        "key" TEXT NOT NULL CONSTRAINT ${quoted(menusKeyUnique)} UNIQUE,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "location" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 10,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${menusTable}_location_idx`)}
      ON ${quoted(menusTable)} ("location")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${menusTable}_order_idx`)}
      ON ${quoted(menusTable)} ("sortOrder")
    `,
  );

  await createNamedRelation(
    executor,
    itemsTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(itemsTable)} (
        "id" TEXT CONSTRAINT ${quoted(itemsPrimaryKey)} PRIMARY KEY,
        "menuId" TEXT NOT NULL CONSTRAINT ${quoted(itemsMenuForeignKey)} REFERENCES ${quoted(menusTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "parentId" TEXT,
        "title" TEXT NOT NULL,
        "href" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "mediaId" INTEGER CONSTRAINT ${quoted(itemsMediaForeignKey)} REFERENCES ${quoted(mediaTable)}("id") ON DELETE SET NULL ON UPDATE CASCADE,
        "target" TEXT,
        "rel" TEXT,
        "external" BOOLEAN NOT NULL DEFAULT FALSE,
        "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "sortOrder" INTEGER NOT NULL DEFAULT 10,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${itemsTable}_menu_idx`)}
      ON ${quoted(itemsTable)} ("menuId")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${itemsTable}_parent_idx`)}
      ON ${quoted(itemsTable)} ("parentId")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${itemsTable}_order_idx`)}
      ON ${quoted(itemsTable)} ("menuId", "sortOrder")
    `,
  );

  await createNamedRelation(
    executor,
    metaIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(metaIdSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    metaTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(metaTable)} (
        "id" INTEGER CONSTRAINT ${quoted(metaPrimaryKey)} PRIMARY KEY,
        "menuItemId" TEXT NOT NULL CONSTRAINT ${quoted(metaMenuItemForeignKey)} REFERENCES ${quoted(itemsTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ${quoted(metaMenuItemKeyUnique)} UNIQUE ("menuItemId", "key")
      )
    `,
    { allowDuplicateType: true },
  );
  await repairMenuMetaIdDefaultAndOwnership(executor, siteId);
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_menu_item_idx`)}
      ON ${quoted(metaTable)} ("menuItemId")
    `,
  );
}

async function ensureMenuMetaIdSequence(executor: SqlExecutor, siteId: string) {
  const metaTable = siteMenuItemMetaTableName(siteId);
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "menu_item_meta_id_seq");
  await createNamedRelation(
    executor,
    metaIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(metaIdSequence)}
    `,
  );
  if (!(await relationExistsWithExecutor(executor, metaIdSequence))) {
    throw createPendingRelationRetryError(metaIdSequence);
  }
  if (!(await relationExistsWithExecutor(executor, metaTable))) {
    throw createPendingRelationRetryError(metaTable);
  }
}

async function repairMenuMetaIdDefaultAndOwnership(executor: SqlExecutor, siteId: string) {
  const metaTable = siteMenuItemMetaTableName(siteId);
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "menu_item_meta_id_seq");
  await executeDdl(
    executor,
    `
      ALTER TABLE ${quoted(metaTable)}
      ALTER COLUMN "id" SET DEFAULT nextval('public.${metaIdSequence}'::regclass)
    `,
  ).catch(async (error) => {
    if (!isMissingPgRelationError(error)) throw error;
    await createNamedRelation(
      executor,
      metaIdSequence,
      `
        CREATE SEQUENCE IF NOT EXISTS ${quoted(metaIdSequence)}
      `,
    );
    await executeDdl(
      executor,
      `
        ALTER TABLE ${quoted(metaTable)}
        ALTER COLUMN "id" SET DEFAULT nextval('public.${metaIdSequence}'::regclass)
      `,
    );
  });
  await executeDdl(
    executor,
    `
      ALTER SEQUENCE ${quoted(metaIdSequence)}
      OWNED BY ${quoted(metaTable)}."id"
    `,
  );
}

async function repairPhysicalSiteMenuTables(executor: SqlExecutor, siteId: string) {
  await ensureMenuMetaIdSequence(executor, siteId);
  await repairMenuMetaIdDefaultAndOwnership(executor, siteId);
}

export async function ensureSiteMenuTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const menusTable = siteMenusTableName(normalizedSiteId);
  const itemsTable = siteMenuItemsTableName(normalizedSiteId);
  const metaTable = siteMenuItemMetaTableName(normalizedSiteId);
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "menu_item_meta_id_seq");
  if (ensuredSites.has(normalizedSiteId)) {
    const hasMenusTable = await relationExistsWithExecutor(db, menusTable);
    const hasItemsTable = await relationExistsWithExecutor(db, itemsTable);
    const hasMetaTable = await relationExistsWithExecutor(db, metaTable);
    const hasMetaSequence = await relationExistsWithExecutor(db, metaIdSequence);
    if (hasMenusTable && hasItemsTable && hasMetaTable && hasMetaSequence) {
      return getSiteMenuTables(normalizedSiteId);
    }
    ensuredSites.delete(normalizedSiteId);
    ensureCache.delete(normalizedSiteId);
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) {
    const hasMenusTable = await relationExistsWithExecutor(db, menusTable);
    const hasItemsTable = await relationExistsWithExecutor(db, itemsTable);
    const hasMetaTable = await relationExistsWithExecutor(db, metaTable);
    const hasMetaSequence = await relationExistsWithExecutor(db, metaIdSequence);
    if (hasMenusTable && hasItemsTable && hasMetaTable && hasMetaSequence) {
      if (await menuMetaIdDefaultNeedsRepair(db, normalizedSiteId)) {
        await withLockRetry(() =>
          db.transaction(async (tx) => {
            const advisoryKey = `${normalizedPrefix}site_menu_tables:${normalizedSiteId}`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
            if (await menuMetaIdDefaultNeedsRepair(tx, normalizedSiteId)) {
              await repairPhysicalSiteMenuTables(tx, normalizedSiteId);
            }
          }),
        );
      }
      ensuredSites.add(normalizedSiteId);
      return cached;
    }
    ensureCache.delete(normalizedSiteId);
  }
  const pending = ensureInFlight.get(normalizedSiteId);
  if (pending) return pending;
  await ensureSiteMediaTable(normalizedSiteId);
  const verifyRelations = async (executor: SqlExecutor) => {
    const hasMenusTable = await relationExistsWithExecutor(executor, menusTable);
    const hasItemsTable = await relationExistsWithExecutor(executor, itemsTable);
    const hasMetaTable = await relationExistsWithExecutor(executor, metaTable);
    const hasMetaSequence = await relationExistsWithExecutor(executor, metaIdSequence);
    return hasMenusTable && hasItemsTable && hasMetaTable && hasMetaSequence;
  };
  const run = withLockRetry(() =>
    db.transaction(async (tx) => {
      const site = await tx.query.sites.findFirst({
        where: eq(sites.id, normalizedSiteId),
        columns: { id: true },
      });
      if (!site) throw new Error("Invalid site.");
      const advisoryKey = `${normalizedPrefix}site_menu_tables:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
      await createPhysicalSiteMenuTables(tx, normalizedSiteId);
      if (!(await verifyRelations(tx))) {
        await createPhysicalSiteMenuTables(tx, normalizedSiteId);
      }
      await repairPhysicalSiteMenuTables(tx, normalizedSiteId);
      ensuredSites.add(normalizedSiteId);
      return getSiteMenuTables(normalizedSiteId);
    }),
  );
  ensureInFlight.set(normalizedSiteId, run);
  return run
    .then(async (resolved) => {
      if (!(await verifyRelations(db))) {
        await createPhysicalSiteMenuTables(db, normalizedSiteId);
      }
      ensuredSites.add(normalizedSiteId);
      return resolved;
    })
    .finally(() => {
      ensureInFlight.delete(normalizedSiteId);
    });
}
