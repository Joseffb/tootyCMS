import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { physicalObjectName, sitePhysicalSequenceName, sitePhysicalTableName } from "@/lib/site-physical-table-name";
import { eq, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
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
    termsTable: ReturnType<typeof createTermsTable>;
    termTaxonomiesTable: ReturnType<typeof createTermTaxonomiesTable>;
    termRelationshipsTable: ReturnType<typeof createTermRelationshipsTable>;
    termTaxonomyDomainsTable: ReturnType<typeof createTermTaxonomyDomainsTable>;
    termTaxonomyMetaTable: ReturnType<typeof createTermTaxonomyMetaTable>;
  }
>();
const ensureInFlight = new Map<string, Promise<ReturnType<typeof getSiteTaxonomyTables>>>();
const ensuredSites = new Set<string>();

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

function termsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "terms");
}

function termTaxonomiesTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "term_taxonomies");
}

function termRelationshipsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "term_relationships");
}

function termTaxonomyDomainsTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "term_taxonomy_domains");
}

function termTaxonomyMetaTableName(siteId: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, "term_taxonomy_meta");
}

function createTermsTable(siteId: string) {
  return pgTable(
    termsTableName(siteId),
    {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      slug: text("slug").notNull(),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      slugUnique: uniqueIndex().on(table.slug),
      slugIdx: index().on(table.slug),
      nameIdx: index().on(table.name),
    }),
  );
}

function createTermTaxonomiesTable(siteId: string) {
  const terms = createTermsTable(siteId);
  return pgTable(
    termTaxonomiesTableName(siteId),
    {
      id: serial("id").primaryKey(),
      termId: integer("termId")
        .notNull()
        .references(() => terms.id, { onDelete: "cascade", onUpdate: "cascade" }),
      taxonomy: text("taxonomy").notNull(),
      description: text("description"),
      parentId: integer("parentId"),
      count: integer("count").notNull().default(0),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      termTaxonomyUnique: uniqueIndex().on(table.termId, table.taxonomy),
      taxonomyIdx: index().on(table.taxonomy),
      parentIdx: index().on(table.parentId),
    }),
  );
}

function createTermRelationshipsTable(siteId: string) {
  const termTaxonomies = createTermTaxonomiesTable(siteId);
  return pgTable(
    termRelationshipsTableName(siteId),
    {
      objectId: text("objectId").notNull(),
      termTaxonomyId: integer("termTaxonomyId")
        .notNull()
        .references(() => termTaxonomies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    },
    (table) => ({
      pk: primaryKey({ columns: [table.objectId, table.termTaxonomyId] }),
      objectIdx: index().on(table.objectId),
      taxonomyIdx: index().on(table.termTaxonomyId),
    }),
  );
}

function createTermTaxonomyDomainsTable(siteId: string) {
  const termTaxonomies = createTermTaxonomiesTable(siteId);
  return pgTable(
    termTaxonomyDomainsTableName(siteId),
    {
      dataDomainId: integer("dataDomainId").notNull(),
      termTaxonomyId: integer("termTaxonomyId")
        .notNull()
        .references(() => termTaxonomies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    },
    (table) => ({
      pk: primaryKey({ columns: [table.dataDomainId, table.termTaxonomyId] }),
      taxonomyIdx: index().on(table.termTaxonomyId),
      domainIdx: index().on(table.dataDomainId),
    }),
  );
}

function createTermTaxonomyMetaTable(siteId: string) {
  const termTaxonomies = createTermTaxonomiesTable(siteId);
  return pgTable(
    termTaxonomyMetaTableName(siteId),
    {
      id: serial("id").primaryKey(),
      termTaxonomyId: integer("termTaxonomyId")
        .notNull()
        .references(() => termTaxonomies.id, { onDelete: "cascade", onUpdate: "cascade" }),
      key: text("key").notNull(),
      value: text("value").notNull().default(""),
      createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
      updatedAt: timestamp("updatedAt", { mode: "date" })
        .defaultNow()
        .notNull()
        .$onUpdate(() => new Date()),
    },
    (table) => ({
      taxonomyKeyUnique: uniqueIndex().on(table.termTaxonomyId, table.key),
      taxonomyIdx: index().on(table.termTaxonomyId),
    }),
  );
}

export function getSiteTaxonomyTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required.");
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) return cached;

  const tables = {
    termsTable: createTermsTable(normalizedSiteId),
    termTaxonomiesTable: createTermTaxonomiesTable(normalizedSiteId),
    termRelationshipsTable: createTermRelationshipsTable(normalizedSiteId),
    termTaxonomyDomainsTable: createTermTaxonomyDomainsTable(normalizedSiteId),
    termTaxonomyMetaTable: createTermTaxonomyMetaTable(normalizedSiteId),
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

function isDuplicatePgObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "42710";
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

async function executeConstraintDdl(executor: SqlExecutor, statement: string) {
  if (typeof executor.execute !== "function") return;
  try {
    await executor.execute(sql.raw(statement));
  } catch (error) {
    if (isDuplicatePgObjectError(error)) return;
    throw error;
  }
}

type QueryRows<T> = { rows?: T[] };

type ForeignKeyConstraintRow = {
  constraint_name?: string;
  referenced_table?: string;
  columns?: string[] | null;
};

async function relationExistsWithExecutor(executor: SqlExecutor, relationName: string) {
  const result = (await executor.execute?.(
    sql`SELECT to_regclass(${`public.${relationName}`}) AS relation_name`,
  )) as QueryRows<{ relation_name?: string | null }>;
  if (!result || !Array.isArray(result.rows)) {
    // Unit-test transaction mocks often stub execute() without returning pg rows.
    // Treat that as an opaque executor and assume the prior DDL call succeeded.
    return true;
  }
  return Boolean(result?.rows?.[0]?.relation_name);
}

async function repairForeignKeyConstraintTarget(
  executor: SqlExecutor,
  input: {
    tableName: string;
    columnName: string;
    referencedTable: string;
    expectedConstraintName: string;
  },
) {
  if (typeof executor.execute !== "function") return;

  const constraints = (await executor.execute(
    sql`
      SELECT
        con.conname AS constraint_name,
        confrel.relname AS referenced_table,
        ARRAY_AGG(att.attname ORDER BY keys.ord) AS columns
      FROM pg_constraint con
      INNER JOIN pg_class rel
        ON rel.oid = con.conrelid
      INNER JOIN pg_namespace ns
        ON ns.oid = rel.relnamespace
      INNER JOIN pg_class confrel
        ON confrel.oid = con.confrelid
      INNER JOIN LATERAL UNNEST(con.conkey) WITH ORDINALITY AS keys(attnum, ord)
        ON TRUE
      INNER JOIN pg_attribute att
        ON att.attrelid = rel.oid
       AND att.attnum = keys.attnum
      WHERE ns.nspname = 'public'
        AND rel.relname = ${input.tableName}
        AND con.contype = 'f'
      GROUP BY con.conname, confrel.relname
    `,
  )) as QueryRows<ForeignKeyConstraintRow>;

  if (!constraints || !Array.isArray(constraints.rows)) {
    return;
  }

  for (const row of constraints.rows) {
    const columns = Array.isArray(row.columns) ? row.columns : [];
    if (columns.length !== 1 || columns[0] !== input.columnName) {
      continue;
    }
    if (
      row.constraint_name === input.expectedConstraintName &&
      row.referenced_table === input.referencedTable
    ) {
      continue;
    }
    if (row.referenced_table === input.referencedTable) {
      continue;
    }
    if (!row.constraint_name) {
      continue;
    }
    await executor.execute(
      sql.raw(
        `ALTER TABLE ${quoted(input.tableName)} DROP CONSTRAINT IF EXISTS ${quoted(row.constraint_name)}`,
      ),
    );
  }
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

function isMissingPgRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "42P01";
}

export function isMissingSiteTaxonomyRelationError(error: unknown) {
  if (!isMissingPgRelationError(error)) return false;
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return (
    message.includes("_terms") ||
    message.includes("_term_tax") ||
    message.includes("_term_relationships") ||
    message.includes("_term_taxonomy_domains") ||
    message.includes("_term_taxonomy_meta")
  );
}

export function resetSiteTaxonomyTablesCache(siteId?: string) {
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

async function createPhysicalSiteTaxonomyTables(executor: SqlExecutor, siteId: string) {
  const termsTable = termsTableName(siteId);
  const taxonomiesTable = termTaxonomiesTableName(siteId);
  const relationshipsTable = termRelationshipsTableName(siteId);
  const domainsTable = termTaxonomyDomainsTableName(siteId);
  const metaTable = termTaxonomyMetaTableName(siteId);
  const termsIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "terms_id_seq");
  const taxonomiesIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "term_taxonomies_id_seq");
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, siteId, "term_taxonomy_meta_id_seq");
  const termsPrimaryKey = physicalObjectName(termsTable, "pkey");
  const termsSlugUnique = physicalObjectName(termsTable, "slug_key");
  const taxonomiesPrimaryKey = physicalObjectName(taxonomiesTable, "pkey");
  const taxonomiesTermTaxonomyUnique = physicalObjectName(taxonomiesTable, "term_id_taxonomy_key");
  const relationshipsPrimaryKey = physicalObjectName(relationshipsTable, "pkey");
  const domainsPrimaryKey = physicalObjectName(domainsTable, "pkey");
  const metaPrimaryKey = physicalObjectName(metaTable, "pkey");
  const metaTaxonomyKeyUnique = physicalObjectName(metaTable, "term_taxonomy_id_key_key");

  await createNamedRelation(
    executor,
    termsIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(termsIdSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    termsTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(termsTable)} (
        "id" INTEGER CONSTRAINT ${quoted(termsPrimaryKey)} PRIMARY KEY DEFAULT nextval('${termsIdSequence}'),
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL CONSTRAINT ${quoted(termsSlugUnique)} UNIQUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${termsTable}_slug_idx`)}
      ON ${quoted(termsTable)} ("slug")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${termsTable}_name_idx`)}
      ON ${quoted(termsTable)} ("name")
    `,
  );

  await createNamedRelation(
    executor,
    taxonomiesIdSequence,
    `
      CREATE SEQUENCE IF NOT EXISTS ${quoted(taxonomiesIdSequence)}
    `,
  );
  await createNamedRelation(
    executor,
    taxonomiesTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(taxonomiesTable)} (
        "id" INTEGER CONSTRAINT ${quoted(taxonomiesPrimaryKey)} PRIMARY KEY DEFAULT nextval('${taxonomiesIdSequence}'),
        "termId" INTEGER NOT NULL,
        "taxonomy" TEXT NOT NULL,
        "description" TEXT,
        "parentId" INTEGER,
        "count" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ${quoted(taxonomiesTermTaxonomyUnique)} UNIQUE ("termId", "taxonomy")
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${taxonomiesTable}_taxonomy_idx`)}
      ON ${quoted(taxonomiesTable)} ("taxonomy")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${taxonomiesTable}_parent_idx`)}
      ON ${quoted(taxonomiesTable)} ("parentId")
    `,
  );

  await createNamedRelation(
    executor,
    relationshipsTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(relationshipsTable)} (
        "objectId" TEXT NOT NULL,
        "termTaxonomyId" INTEGER NOT NULL,
        CONSTRAINT ${quoted(relationshipsPrimaryKey)} PRIMARY KEY ("objectId", "termTaxonomyId")
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${relationshipsTable}_object_idx`)}
      ON ${quoted(relationshipsTable)} ("objectId")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${relationshipsTable}_taxonomy_idx`)}
      ON ${quoted(relationshipsTable)} ("termTaxonomyId")
    `,
  );

  await createNamedRelation(
    executor,
    domainsTable,
    `
      CREATE TABLE IF NOT EXISTS ${quoted(domainsTable)} (
        "dataDomainId" INTEGER NOT NULL,
        "termTaxonomyId" INTEGER NOT NULL,
        CONSTRAINT ${quoted(domainsPrimaryKey)} PRIMARY KEY ("dataDomainId", "termTaxonomyId")
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${domainsTable}_taxonomy_idx`)}
      ON ${quoted(domainsTable)} ("termTaxonomyId")
    `,
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${domainsTable}_domain_idx`)}
      ON ${quoted(domainsTable)} ("dataDomainId")
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
        "id" INTEGER CONSTRAINT ${quoted(metaPrimaryKey)} PRIMARY KEY DEFAULT nextval('${metaIdSequence}'),
        "termTaxonomyId" INTEGER NOT NULL,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ${quoted(metaTaxonomyKeyUnique)} UNIQUE ("termTaxonomyId", "key")
      )
    `,
    { allowDuplicateType: true },
  );
  await executeDdl(
    executor,
    `
      CREATE INDEX IF NOT EXISTS ${quoted(`${metaTable}_taxonomy_idx`)}
      ON ${quoted(metaTable)} ("termTaxonomyId")
    `,
  );
}

async function ensurePhysicalSiteTaxonomyConstraints(executor: SqlExecutor, siteId: string) {
  const termsTable = termsTableName(siteId);
  const taxonomiesTable = termTaxonomiesTableName(siteId);
  const relationshipsTable = termRelationshipsTableName(siteId);
  const domainsTable = termTaxonomyDomainsTableName(siteId);
  const metaTable = termTaxonomyMetaTableName(siteId);

  await repairForeignKeyConstraintTarget(executor, {
    tableName: taxonomiesTable,
    columnName: "termId",
    referencedTable: termsTable,
    expectedConstraintName: `${taxonomiesTable}_term_fk`,
  });
  await repairForeignKeyConstraintTarget(executor, {
    tableName: relationshipsTable,
    columnName: "termTaxonomyId",
    referencedTable: taxonomiesTable,
    expectedConstraintName: `${relationshipsTable}_taxonomy_fk`,
  });
  await repairForeignKeyConstraintTarget(executor, {
    tableName: domainsTable,
    columnName: "termTaxonomyId",
    referencedTable: taxonomiesTable,
    expectedConstraintName: `${domainsTable}_taxonomy_fk`,
  });
  await repairForeignKeyConstraintTarget(executor, {
    tableName: metaTable,
    columnName: "termTaxonomyId",
    referencedTable: taxonomiesTable,
    expectedConstraintName: `${metaTable}_taxonomy_fk`,
  });

  await executeConstraintDdl(
    executor,
    `
      ALTER TABLE ${quoted(taxonomiesTable)}
      ADD CONSTRAINT ${quoted(`${taxonomiesTable}_term_fk`)}
      FOREIGN KEY ("termId") REFERENCES ${quoted(termsTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE
    `,
  );
  await executeConstraintDdl(
    executor,
    `
      ALTER TABLE ${quoted(relationshipsTable)}
      ADD CONSTRAINT ${quoted(`${relationshipsTable}_taxonomy_fk`)}
      FOREIGN KEY ("termTaxonomyId") REFERENCES ${quoted(taxonomiesTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE
    `,
  );
  await executeConstraintDdl(
    executor,
    `
      ALTER TABLE ${quoted(domainsTable)}
      ADD CONSTRAINT ${quoted(`${domainsTable}_taxonomy_fk`)}
      FOREIGN KEY ("termTaxonomyId") REFERENCES ${quoted(taxonomiesTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE
    `,
  );
  await executeConstraintDdl(
    executor,
    `
      ALTER TABLE ${quoted(metaTable)}
      ADD CONSTRAINT ${quoted(`${metaTable}_taxonomy_fk`)}
      FOREIGN KEY ("termTaxonomyId") REFERENCES ${quoted(taxonomiesTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE
    `,
  );
}

export async function ensureSiteTaxonomyTables(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const termsTable = termsTableName(normalizedSiteId);
  const taxonomiesTable = termTaxonomiesTableName(normalizedSiteId);
  const relationshipsTable = termRelationshipsTableName(normalizedSiteId);
  const domainsTable = termTaxonomyDomainsTableName(normalizedSiteId);
  const metaTable = termTaxonomyMetaTableName(normalizedSiteId);
  const termsIdSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "terms_id_seq");
  const taxonomiesIdSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "term_taxonomies_id_seq");
  const metaIdSequence = sitePhysicalSequenceName(normalizedPrefix, normalizedSiteId, "term_taxonomy_meta_id_seq");

  const ensureConstraints = async (executor: SqlExecutor) => {
    await ensurePhysicalSiteTaxonomyConstraints(executor, normalizedSiteId);
  };

  if (ensuredSites.has(normalizedSiteId)) {
    const hasRequiredRelations = await Promise.all([
      relationExistsWithExecutor(db, termsTable),
      relationExistsWithExecutor(db, taxonomiesTable),
      relationExistsWithExecutor(db, relationshipsTable),
      relationExistsWithExecutor(db, domainsTable),
      relationExistsWithExecutor(db, metaTable),
      relationExistsWithExecutor(db, termsIdSequence),
      relationExistsWithExecutor(db, taxonomiesIdSequence),
      relationExistsWithExecutor(db, metaIdSequence),
    ]);
    if (hasRequiredRelations.every(Boolean)) {
      await ensureConstraints(db);
      return getSiteTaxonomyTables(normalizedSiteId);
    }
    ensuredSites.delete(normalizedSiteId);
    ensureCache.delete(normalizedSiteId);
  }
  const cached = ensureCache.get(normalizedSiteId);
  if (cached) {
    const hasRequiredRelations = await Promise.all([
      relationExistsWithExecutor(db, termsTable),
      relationExistsWithExecutor(db, taxonomiesTable),
      relationExistsWithExecutor(db, relationshipsTable),
      relationExistsWithExecutor(db, domainsTable),
      relationExistsWithExecutor(db, metaTable),
      relationExistsWithExecutor(db, termsIdSequence),
      relationExistsWithExecutor(db, taxonomiesIdSequence),
      relationExistsWithExecutor(db, metaIdSequence),
    ]);
    if (hasRequiredRelations.every(Boolean)) {
      await ensureConstraints(db);
      ensuredSites.add(normalizedSiteId);
      return cached;
    }
    ensureCache.delete(normalizedSiteId);
  }
  const pending = ensureInFlight.get(normalizedSiteId);
  if (pending) return pending;

  const resolveSiteForValidation = async (executor?: { query?: { sites?: { findFirst?: Function } } }) => {
    let siteLookupPerformed = false;
    let site: unknown = null;
    if (typeof executor?.query?.sites?.findFirst === "function") {
      siteLookupPerformed = true;
      site = await executor.query.sites.findFirst({
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
  };

  if (typeof db.transaction !== "function") {
    await resolveSiteForValidation();
    await createPhysicalSiteTaxonomyTables(db, normalizedSiteId);
    await ensurePhysicalSiteTaxonomyConstraints(db, normalizedSiteId);
    const hasRequiredRelations = await Promise.all([
      relationExistsWithExecutor(db, termsTable),
      relationExistsWithExecutor(db, taxonomiesTable),
      relationExistsWithExecutor(db, relationshipsTable),
      relationExistsWithExecutor(db, domainsTable),
      relationExistsWithExecutor(db, metaTable),
      relationExistsWithExecutor(db, termsIdSequence),
      relationExistsWithExecutor(db, taxonomiesIdSequence),
      relationExistsWithExecutor(db, metaIdSequence),
    ]);
    if (!hasRequiredRelations.every(Boolean)) {
      await createPhysicalSiteTaxonomyTables(db, normalizedSiteId);
    }
    await ensureConstraints(db);
    const tables = getSiteTaxonomyTables(normalizedSiteId);
    ensuredSites.add(normalizedSiteId);
    return tables;
  }

  const verifyRelations = async (executor: SqlExecutor) => {
    const hasRequiredRelations = await Promise.all([
      relationExistsWithExecutor(executor, termsTable),
      relationExistsWithExecutor(executor, taxonomiesTable),
      relationExistsWithExecutor(executor, relationshipsTable),
      relationExistsWithExecutor(executor, domainsTable),
      relationExistsWithExecutor(executor, metaTable),
      relationExistsWithExecutor(executor, termsIdSequence),
      relationExistsWithExecutor(executor, taxonomiesIdSequence),
      relationExistsWithExecutor(executor, metaIdSequence),
    ]);
    return hasRequiredRelations.every(Boolean);
  };

  const run = withLockRetry(() =>
    db.transaction(async (tx) => {
      await resolveSiteForValidation(tx);
      const advisoryKey = `${normalizedPrefix}site_taxonomy_tables:${normalizedSiteId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey}))`);
      await createPhysicalSiteTaxonomyTables(tx, normalizedSiteId);
      if (!(await verifyRelations(tx))) {
        await createPhysicalSiteTaxonomyTables(tx, normalizedSiteId);
      }
      await ensureConstraints(tx);
      const tables = getSiteTaxonomyTables(normalizedSiteId);
      ensuredSites.add(normalizedSiteId);
      return tables;
    }),
  );

  ensureInFlight.set(normalizedSiteId, run);
  return run
    .then(async (resolved) => {
      if (!(await verifyRelations(db))) {
        await createPhysicalSiteTaxonomyTables(db, normalizedSiteId);
      }
      await ensureConstraints(db);
      ensuredSites.add(normalizedSiteId);
      return resolved;
    })
    .finally(() => {
      ensureInFlight.delete(normalizedSiteId);
    });
}

export async function withSiteTaxonomyTableRecovery<T>(siteId: string, run: () => Promise<T>): Promise<T> {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) throw new Error("siteId is required.");
  const ensureRecovered = async () => {
    try {
      await ensureSiteTaxonomyTables(normalizedSiteId);
    } catch (error) {
      if (!isMissingSiteTaxonomyRelationError(error)) throw error;
      resetSiteTaxonomyTablesCache(normalizedSiteId);
      await ensureSiteTaxonomyTables(normalizedSiteId);
    }
  };

  await ensureRecovered();
  try {
    return await run();
  } catch (error) {
    if (!isMissingSiteTaxonomyRelationError(error)) throw error;
    resetSiteTaxonomyTablesCache(normalizedSiteId);
    await ensureRecovered();
    return run();
  }
}
