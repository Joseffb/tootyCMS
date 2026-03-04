import db from "@/lib/db";
import { sql } from "drizzle-orm";
import { trace } from "@/lib/debug";
import { getTextSetting, setTextSetting } from "@/lib/cms-config";
import { isCompatModeEnabled } from "@/lib/compat-mode";

type RequiredColumn = {
  tableSuffix: "site_posts" | "site_domain_posts" | "site_media" | "site_data_domains" | "site_term_taxonomies";
  column:
    | "image"
    | "imageBlurhash"
    | "password"
    | "usePassword"
    | "altText"
    | "caption"
    | "description"
    | "siteId";
};

export type MissingDbColumn = {
  table: string;
  column: string;
};

export const DB_SCHEMA_VERSION_KEY = "db_schema_version";
export const DB_SCHEMA_TARGET_VERSION_KEY = "db_schema_target_version";
export const DB_SCHEMA_UPDATED_AT_KEY = "db_schema_updated_at";
export const TARGET_DB_SCHEMA_VERSION = "2026.03.04.3";

async function safeGetSetting(key: string, fallback: string) {
  try {
    return await getTextSetting(key, fallback);
  } catch {
    return fallback;
  }
}

const REQUIRED_COLUMNS: RequiredColumn[] = [
  { tableSuffix: "site_posts", column: "image" },
  { tableSuffix: "site_posts", column: "imageBlurhash" },
  { tableSuffix: "site_domain_posts", column: "image" },
  { tableSuffix: "site_domain_posts", column: "imageBlurhash" },
  { tableSuffix: "site_domain_posts", column: "password" },
  { tableSuffix: "site_domain_posts", column: "usePassword" },
  { tableSuffix: "site_media", column: "altText" },
  { tableSuffix: "site_media", column: "caption" },
  { tableSuffix: "site_media", column: "description" },
  { tableSuffix: "site_data_domains", column: "description" },
  { tableSuffix: "site_term_taxonomies", column: "siteId" },
];

const REQUIRED_TABLE_SUFFIXES = [
  "site_media",
  "site_menus",
  "site_menu_items",
  "site_menu_item_meta",
  "site_communication_messages",
  "site_communication_attempts",
  "site_webcallback_events",
  "site_webhook_subscriptions",
  "site_webhook_deliveries",
  "domain_events_queue",
  "site_term_taxonomy_meta",
] as const;

function getPrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function toTableName(suffix: RequiredColumn["tableSuffix"]) {
  return `${getPrefix()}${suffix}`;
}

function hasMissingColumnsForTable(missing: MissingDbColumn[], tableSuffix: RequiredColumn["tableSuffix"]) {
  const table = toTableName(tableSuffix);
  return missing.some((entry) => entry.table === table);
}

function hasMissingContentColumns(missing: MissingDbColumn[]) {
  return hasMissingColumnsForTable(missing, "site_posts") || hasMissingColumnsForTable(missing, "site_domain_posts");
}

export async function getDatabaseHealthReport() {
  const prefix = getPrefix();
  const tableNames = Array.from(new Set(REQUIRED_COLUMNS.map((entry) => toTableName(entry.tableSuffix))));
  const tableNameSql = sql.join(tableNames.map((name) => sql`${name}`), sql`,`);

  const result = await db.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (${tableNameSql})
  `);

  const rows = (result as any)?.rows ?? [];
  const existing = new Set(rows.map((row: any) => `${String(row.table_name)}.${String(row.column_name)}`));

  const missing: MissingDbColumn[] = REQUIRED_COLUMNS.flatMap((entry) => {
    const table = toTableName(entry.tableSuffix);
    return existing.has(`${table}.${entry.column}`) ? [] : [{ table, column: entry.column }];
  });

  const requiredTables = REQUIRED_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`);
  const requiredTableSql = sql.join(requiredTables.map((name) => sql`${name}`), sql`,`);
  const tableResult = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${requiredTableSql})
  `);
  const existingTables = new Set(((tableResult as any)?.rows ?? []).map((row: any) => String(row.table_name)));
  const missingTables = requiredTables.filter((name) => !existingTables.has(name));

  const disallowedGlobalFeatureTables = [
    `${prefix}data_domains`,
    `${prefix}posts`,
    `${prefix}post_meta`,
    `${prefix}post_categories`,
    `${prefix}post_tags`,
    `${prefix}categories`,
    `${prefix}tags`,
    `${prefix}terms`,
    `${prefix}term_taxonomies`,
    `${prefix}term_relationships`,
    `${prefix}term_taxonomy_domains`,
    `${prefix}term_taxonomy_meta`,
    `${prefix}comments`,
    `${prefix}examples`,
    `${prefix}domain_carousel`,
    `${prefix}domain_carousel_meta`,
    `${prefix}domain_carousel-slide`,
    `${prefix}domain_carousel-slide_meta`,
    `${prefix}domain_posts`,
    `${prefix}domain_post_meta`,
  ];
  const disallowedTableSql = sql.join(disallowedGlobalFeatureTables.map((name) => sql`${name}`), sql`,`);
  const disallowedResult = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${disallowedTableSql})
  `);
  const disallowedFound = ((disallowedResult as any)?.rows ?? []).map((row: any) => String(row.table_name));

  if (missing.length > 0 || missingTables.length > 0) {
    trace("db", "database update required", { missingColumns: missing, missingTables });
  }

  const currentVersion = await safeGetSetting(DB_SCHEMA_VERSION_KEY, "");
  const targetVersion = TARGET_DB_SCHEMA_VERSION;
  const versionBehind = currentVersion !== targetVersion;
  const compatMode = isCompatModeEnabled();
  const migrationRequired = missing.length > 0 || missingTables.length > 0 || disallowedFound.length > 0 || versionBehind;
  const pending = [
    ...(missingTables.length > 0
      ? [
          {
            id: "2026.02.26.1-required-tables",
            title: "Create required communication/taxonomy compatibility tables",
            reason: "Missing required communication queue/webhook and/or taxonomy meta tables.",
          },
        ]
      : []),
    ...(missingTables.some((table) =>
      [`${prefix}site_menus`, `${prefix}site_menu_items`, `${prefix}site_menu_item_meta`].includes(table),
    )
      ? [
          {
            id: "2026.03.02.1-native-menus",
            title: "Create native menu tables",
            reason: "Missing required native menu tables for the built-in menu spine.",
          },
        ]
      : []),
    ...(hasMissingContentColumns(missing)
      ? [
          {
            id: "2026.02.24.1-columns",
            title: "Add required columns to content tables",
            reason: "Missing required image/imageBlurhash/password/usePassword columns.",
          },
        ]
      : []),
    ...(hasMissingColumnsForTable(missing, "site_media")
      ? [
          {
            id: "2026.03.02.1-media-metadata",
            title: "Add required media metadata columns",
            reason: "Missing required altText/caption/description columns on the media table.",
          },
        ]
      : []),
    ...(hasMissingColumnsForTable(missing, "site_data_domains")
      ? [
          {
            id: "2026.03.04.1-site-domain-descriptions",
            title: "Add site-scoped data domain description column",
            reason: "Missing required description column on the site data domain mapping table.",
          },
        ]
      : []),
    ...(hasMissingColumnsForTable(missing, "site_term_taxonomies")
      ? [
          {
            id: "2026.03.04.2-site-taxonomies",
            title: "Migrate taxonomy records to strict site ownership",
            reason: "Missing required siteId column on term taxonomies.",
          },
        ]
      : []),
    ...(versionBehind
      ? [
          {
            id: "2026.03.02.1-version",
            title: "Record schema version",
            reason: "Installed schema version is not at current target.",
          },
        ]
      : []),
    ...(disallowedFound.length > 0
      ? [
          {
            id: "2026.03.04.3-site-scope-hardening",
            title: "Migrate feature data off global tables",
            reason:
              "Global feature tables detected; network/global schema must remain sparse and admin-only by contract.",
          },
        ]
      : []),
  ];

  return {
    ok: !migrationRequired,
    migrationRequired,
    compatMode,
    pending,
    currentVersion: currentVersion || "(untracked)",
    targetVersion,
    missing,
    missingTables,
    disallowedFound,
  };
}

function quoteIdentifier(input: string) {
  return `"${input.replace(/"/g, "\"\"")}"`;
}

export async function applyDatabaseCompatibilityFixes() {
  const prefix = getPrefix();
  const postsTable = toTableName("site_posts");
  const domainPostsTable = toTableName("site_domain_posts");
  const communicationMessagesTable = `${prefix}site_communication_messages`;
  const communicationAttemptsTable = `${prefix}site_communication_attempts`;
  const siteMenusTable = `${prefix}site_menus`;
  const siteMenuItemsTable = `${prefix}site_menu_items`;
  const siteMenuItemMetaTable = `${prefix}site_menu_item_meta`;
  const webcallbackEventsTable = `${prefix}site_webcallback_events`;
  const webhookSubscriptionsTable = `${prefix}site_webhook_subscriptions`;
  const webhookDeliveriesTable = `${prefix}site_webhook_deliveries`;
  const domainEventsQueueTable = `${prefix}domain_events_queue`;
  const termTaxonomiesTable = `${prefix}site_term_taxonomies`;
  const termTaxonomyDomainsTable = `${prefix}site_term_taxonomy_domains`;
  const termRelationshipsTable = `${prefix}site_term_relationships`;
  const sitesTable = `${prefix}sites`;
  const termTaxonomyMetaTable = `${prefix}site_term_taxonomy_meta`;
  const mediaTable = `${prefix}site_media`;
  const siteDataDomainsTable = `${prefix}site_data_domains`;

  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(mediaTable)} (
        "id" serial PRIMARY KEY,
        "siteId" text NULL,
        "userId" text NULL,
        "provider" text NOT NULL DEFAULT 'blob',
        "bucket" text NULL,
        "objectKey" text NOT NULL,
        "url" text NOT NULL,
        "label" text NULL,
        "altText" text NULL,
        "caption" text NULL,
        "description" text NULL,
        "mimeType" text NULL,
        "size" integer NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(siteMenusTable)} (
        "id" text PRIMARY KEY,
        "siteId" text NOT NULL,
        "key" text NOT NULL,
        "title" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "location" text NULL,
        "sortOrder" integer NOT NULL DEFAULT 10,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(siteMenuItemsTable)} (
        "id" text PRIMARY KEY,
        "menuId" text NOT NULL,
        "parentId" text NULL,
        "title" text NOT NULL,
        "href" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "mediaId" integer NULL,
        "target" text NULL,
        "rel" text NULL,
        "external" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 10,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(siteMenuItemMetaTable)} (
        "id" serial PRIMARY KEY,
        "menuItemId" text NOT NULL,
        "key" text NOT NULL,
        "value" text NOT NULL DEFAULT '',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(mediaTable)}
          ADD CONSTRAINT "${mediaTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(siteMenusTable)}
          ADD CONSTRAINT "${siteMenusTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(siteMenuItemsTable)}
          ADD CONSTRAINT "${siteMenuItemsTable}_menuId_fkey"
          FOREIGN KEY ("menuId") REFERENCES ${quoteIdentifier(siteMenusTable)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(siteMenuItemsTable)}
          ADD CONSTRAINT "${siteMenuItemsTable}_mediaId_fkey"
          FOREIGN KEY ("mediaId") REFERENCES ${quoteIdentifier(mediaTable)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(siteMenuItemMetaTable)}
          ADD CONSTRAINT "${siteMenuItemMetaTable}_menuItemId_fkey"
          FOREIGN KEY ("menuItemId") REFERENCES ${quoteIdentifier(siteMenuItemsTable)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(mediaTable)}
          ADD CONSTRAINT "${mediaTable}_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES ${quoteIdentifier(`${prefix}users`)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${mediaTable}_objectKey_idx" ON ${quoteIdentifier(mediaTable)} ("objectKey")`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(mediaTable)} ADD COLUMN IF NOT EXISTS "altText" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(mediaTable)} ADD COLUMN IF NOT EXISTS "caption" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(mediaTable)} ADD COLUMN IF NOT EXISTS "description" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(siteDataDomainsTable)} ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(termTaxonomiesTable)} ADD COLUMN IF NOT EXISTS "siteId" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ DECLARE idx_name text; BEGIN
        FOR idx_name IN
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = '${termTaxonomiesTable.replace(/'/g, "''")}'
            AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%("termId", "taxonomy")%'
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
        END LOOP;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `WITH primary_site AS (
        SELECT COALESCE(
          (SELECT id FROM ${quoteIdentifier(sitesTable)} WHERE "isPrimary" = true ORDER BY "createdAt" ASC LIMIT 1),
          (SELECT id FROM ${quoteIdentifier(sitesTable)} WHERE subdomain = 'main' ORDER BY "createdAt" ASC LIMIT 1),
          (SELECT id FROM ${quoteIdentifier(sitesTable)} ORDER BY "createdAt" ASC LIMIT 1)
        ) AS id
      ),
      usage_map AS (
        SELECT tr."termTaxonomyId" AS taxonomy_id, MIN(dp."siteId") AS site_id
        FROM ${quoteIdentifier(termRelationshipsTable)} tr
        INNER JOIN ${quoteIdentifier(domainPostsTable)} dp ON dp.id = tr."objectId"
        WHERE dp."siteId" IS NOT NULL
        GROUP BY tr."termTaxonomyId"
      )
      UPDATE ${quoteIdentifier(termTaxonomiesTable)} tt
      SET "siteId" = COALESCE(
        (
          SELECT usage_map.site_id
          FROM usage_map
          WHERE usage_map.taxonomy_id = tt.id
          LIMIT 1
        ),
        primary_site.id
      )
      FROM primary_site
      WHERE tt."siteId" IS NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `INSERT INTO ${quoteIdentifier(termTaxonomiesTable)} ("siteId", "termId", "taxonomy", "description", "parentId", "count", "createdAt", "updatedAt")
      SELECT DISTINCT
        dp."siteId",
        source."termId",
        source."taxonomy",
        source."description",
        NULL::integer,
        source."count",
        NOW(),
        NOW()
      FROM ${quoteIdentifier(termRelationshipsTable)} tr
      INNER JOIN ${quoteIdentifier(domainPostsTable)} dp ON dp.id = tr."objectId"
      INNER JOIN ${quoteIdentifier(termTaxonomiesTable)} source ON source.id = tr."termTaxonomyId"
      LEFT JOIN ${quoteIdentifier(termTaxonomiesTable)} existing
        ON existing."siteId" = dp."siteId"
       AND existing."termId" = source."termId"
       AND existing."taxonomy" = source."taxonomy"
      WHERE dp."siteId" IS NOT NULL
        AND existing.id IS NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `UPDATE ${quoteIdentifier(termRelationshipsTable)} tr
      SET "termTaxonomyId" = target.id
      FROM ${quoteIdentifier(domainPostsTable)} dp
      INNER JOIN ${quoteIdentifier(termTaxonomiesTable)} source ON true
      INNER JOIN ${quoteIdentifier(termTaxonomiesTable)} target ON true
      WHERE dp.id = tr."objectId"
        AND dp."siteId" IS NOT NULL
        AND source.id = tr."termTaxonomyId"
        AND target."siteId" = dp."siteId"
        AND target."termId" = source."termId"
        AND target."taxonomy" = source."taxonomy"
        AND tr."termTaxonomyId" <> target.id`,
    ),
  );
  await db.execute(
    sql.raw(
      `INSERT INTO ${quoteIdentifier(termTaxonomyMetaTable)} ("termTaxonomyId", "key", "value", "createdAt", "updatedAt")
      SELECT DISTINCT
        target.id,
        source_meta."key",
        source_meta."value",
        NOW(),
        NOW()
      FROM ${quoteIdentifier(termTaxonomiesTable)} source
      INNER JOIN ${quoteIdentifier(termTaxonomyMetaTable)} source_meta ON source_meta."termTaxonomyId" = source.id
      INNER JOIN ${quoteIdentifier(termTaxonomiesTable)} target
        ON target."termId" = source."termId"
       AND target."taxonomy" = source."taxonomy"
      LEFT JOIN ${quoteIdentifier(termTaxonomyMetaTable)} existing
        ON existing."termTaxonomyId" = target.id
       AND existing."key" = source_meta."key"
      WHERE existing.id IS NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `INSERT INTO ${quoteIdentifier(termTaxonomyDomainsTable)} ("dataDomainId", "termTaxonomyId")
      SELECT DISTINCT
        source_domains."dataDomainId",
        target.id
      FROM ${quoteIdentifier(termTaxonomiesTable)} source
      INNER JOIN ${quoteIdentifier(termTaxonomyDomainsTable)} source_domains ON source_domains."termTaxonomyId" = source.id
      INNER JOIN ${quoteIdentifier(termTaxonomiesTable)} target
        ON target."termId" = source."termId"
       AND target."taxonomy" = source."taxonomy"
      LEFT JOIN ${quoteIdentifier(termTaxonomyDomainsTable)} existing
        ON existing."dataDomainId" = source_domains."dataDomainId"
       AND existing."termTaxonomyId" = target.id
      WHERE existing."termTaxonomyId" IS NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(termTaxonomiesTable)} ALTER COLUMN "siteId" SET NOT NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(termTaxonomiesTable)}
          ADD CONSTRAINT "${termTaxonomiesTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(sitesTable)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${termTaxonomiesTable}_site_term_taxonomy_unique_idx" ON ${quoteIdentifier(termTaxonomiesTable)} ("siteId", "termId", "taxonomy")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${termTaxonomiesTable}_site_taxonomy_idx" ON ${quoteIdentifier(termTaxonomiesTable)} ("siteId", "taxonomy")`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(postsTable)} ADD COLUMN IF NOT EXISTS "image" text DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(postsTable)} ADD COLUMN IF NOT EXISTS "imageBlurhash" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "image" text DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "imageBlurhash" text`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "password" text DEFAULT ''`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(domainPostsTable)} ADD COLUMN IF NOT EXISTS "usePassword" boolean NOT NULL DEFAULT false`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(communicationMessagesTable)} (
        "id" text PRIMARY KEY,
        "siteId" text NULL,
        "channel" text NOT NULL,
        "to" text NOT NULL,
        "subject" text NULL,
        "body" text NOT NULL,
        "category" text NOT NULL DEFAULT 'transactional',
        "status" text NOT NULL DEFAULT 'queued',
        "providerId" text NULL,
        "externalId" text NULL,
        "attemptCount" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 3,
        "nextAttemptAt" timestamp NULL,
        "lastError" text NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdByUserId" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(communicationAttemptsTable)} (
        "id" serial PRIMARY KEY,
        "messageId" text NOT NULL,
        "providerId" text NOT NULL,
        "eventId" text NULL,
        "status" text NOT NULL,
        "error" text NULL,
        "response" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(webcallbackEventsTable)} (
        "id" serial PRIMARY KEY,
        "siteId" text NULL,
        "handlerId" text NOT NULL,
        "pluginId" text NULL,
        "status" text NOT NULL DEFAULT 'received',
        "requestBody" text NOT NULL DEFAULT '',
        "requestHeaders" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "requestQuery" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "response" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "error" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(webhookSubscriptionsTable)} (
        "id" serial PRIMARY KEY,
        "siteId" text NULL,
        "eventName" text NOT NULL,
        "endpointUrl" text NOT NULL,
        "secret" text NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "maxRetries" integer NOT NULL DEFAULT 4,
        "backoffBaseSeconds" integer NOT NULL DEFAULT 30,
        "headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(webhookDeliveriesTable)} (
        "id" text PRIMARY KEY,
        "subscriptionId" integer NOT NULL,
        "siteId" text NULL,
        "eventId" text NOT NULL,
        "eventName" text NOT NULL,
        "endpointUrl" text NOT NULL,
        "status" text NOT NULL DEFAULT 'queued',
        "attemptCount" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 4,
        "nextAttemptAt" timestamp NULL,
        "lastError" text NULL,
        "requestBody" text NOT NULL DEFAULT '',
        "requestHeaders" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "responseStatus" integer NULL,
        "responseBody" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(webcallbackEventsTable)} ADD COLUMN IF NOT EXISTS "siteId" text NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE ${quoteIdentifier(communicationAttemptsTable)} ADD COLUMN IF NOT EXISTS "eventId" text NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(domainEventsQueueTable)} (
        "id" text PRIMARY KEY,
        "event" jsonb NOT NULL,
        "status" text NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "last_error" text NULL,
        "processed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(termTaxonomyMetaTable)} (
        "id" serial PRIMARY KEY,
        "termTaxonomyId" integer NOT NULL REFERENCES ${quoteIdentifier(`${prefix}site_term_taxonomies`)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "key" text NOT NULL,
        "value" text NOT NULL DEFAULT '',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(communicationMessagesTable)}
          ADD CONSTRAINT "${communicationMessagesTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(communicationMessagesTable)}
          ADD CONSTRAINT "${communicationMessagesTable}_createdByUserId_fkey"
          FOREIGN KEY ("createdByUserId") REFERENCES ${quoteIdentifier(`${prefix}users`)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(communicationAttemptsTable)}
          ADD CONSTRAINT "${communicationAttemptsTable}_messageId_fkey"
          FOREIGN KEY ("messageId") REFERENCES ${quoteIdentifier(communicationMessagesTable)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(webcallbackEventsTable)}
          ADD CONSTRAINT "${webcallbackEventsTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(webhookSubscriptionsTable)}
          ADD CONSTRAINT "${webhookSubscriptionsTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(webhookDeliveriesTable)}
          ADD CONSTRAINT "${webhookDeliveriesTable}_subscriptionId_fkey"
          FOREIGN KEY ("subscriptionId") REFERENCES ${quoteIdentifier(webhookSubscriptionsTable)}("id")
          ON UPDATE CASCADE ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `DO $$ BEGIN
        ALTER TABLE ${quoteIdentifier(webhookDeliveriesTable)}
          ADD CONSTRAINT "${webhookDeliveriesTable}_siteId_fkey"
          FOREIGN KEY ("siteId") REFERENCES ${quoteIdentifier(`${prefix}sites`)}("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${communicationMessagesTable}_status_idx" ON ${quoteIdentifier(communicationMessagesTable)} ("status")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${siteMenusTable}_site_key_idx" ON ${quoteIdentifier(siteMenusTable)} ("siteId", "key")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenusTable}_site_location_idx" ON ${quoteIdentifier(siteMenusTable)} ("siteId", "location")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenusTable}_site_sort_idx" ON ${quoteIdentifier(siteMenusTable)} ("siteId", "sortOrder")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenuItemsTable}_menu_idx" ON ${quoteIdentifier(siteMenuItemsTable)} ("menuId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenuItemsTable}_parent_idx" ON ${quoteIdentifier(siteMenuItemsTable)} ("parentId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenuItemsTable}_menu_sort_idx" ON ${quoteIdentifier(siteMenuItemsTable)} ("menuId", "sortOrder")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${siteMenuItemMetaTable}_menuItemId_idx" ON ${quoteIdentifier(siteMenuItemMetaTable)} ("menuItemId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${siteMenuItemMetaTable}_menu_item_key_idx" ON ${quoteIdentifier(siteMenuItemMetaTable)} ("menuItemId", "key")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${communicationMessagesTable}_nextAttemptAt_idx" ON ${quoteIdentifier(communicationMessagesTable)} ("nextAttemptAt")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${communicationAttemptsTable}_messageId_idx" ON ${quoteIdentifier(communicationAttemptsTable)} ("messageId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${communicationAttemptsTable}_provider_event_idx" ON ${quoteIdentifier(communicationAttemptsTable)} ("providerId", "eventId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webcallbackEventsTable}_siteId_idx" ON ${quoteIdentifier(webcallbackEventsTable)} ("siteId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webcallbackEventsTable}_handlerId_idx" ON ${quoteIdentifier(webcallbackEventsTable)} ("handlerId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webhookSubscriptionsTable}_siteId_idx" ON ${quoteIdentifier(webhookSubscriptionsTable)} ("siteId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webhookSubscriptionsTable}_eventName_idx" ON ${quoteIdentifier(webhookSubscriptionsTable)} ("eventName")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${webhookSubscriptionsTable}_site_event_endpoint_idx" ON ${quoteIdentifier(webhookSubscriptionsTable)} ("siteId", "eventName", "endpointUrl")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webhookDeliveriesTable}_subscriptionId_idx" ON ${quoteIdentifier(webhookDeliveriesTable)} ("subscriptionId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webhookDeliveriesTable}_status_idx" ON ${quoteIdentifier(webhookDeliveriesTable)} ("status")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${webhookDeliveriesTable}_nextAttemptAt_idx" ON ${quoteIdentifier(webhookDeliveriesTable)} ("nextAttemptAt")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${webhookDeliveriesTable}_subscription_event_idx" ON ${quoteIdentifier(webhookDeliveriesTable)} ("subscriptionId", "eventId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${domainEventsQueueTable}_status_due_idx" ON ${quoteIdentifier(domainEventsQueueTable)} ("status", "available_at")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${termTaxonomyMetaTable}_termTaxonomyId_idx" ON ${quoteIdentifier(termTaxonomyMetaTable)} ("termTaxonomyId")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${termTaxonomyMetaTable}_term_taxonomy_key_idx" ON ${quoteIdentifier(termTaxonomyMetaTable)} ("termTaxonomyId", "key")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${domainPostsTable}_site_domain_published_updated_idx" ON ${quoteIdentifier(domainPostsTable)} ("siteId", "dataDomainId", "published", "updatedAt")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${domainPostsTable}_site_slug_idx" ON ${quoteIdentifier(domainPostsTable)} ("siteId", "slug")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${domainPostsTable}_site_domain_slug_idx" ON ${quoteIdentifier(domainPostsTable)} ("siteId", "dataDomainId", "slug")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${mediaTable}_site_createdAt_idx" ON ${quoteIdentifier(mediaTable)} ("siteId", "createdAt")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${prefix}site_term_relationships_object_id_idx" ON ${quoteIdentifier(`${prefix}site_term_relationships`)} ("objectId")`,
    ),
  );

  trace("db", "database compatibility fixes applied", {
    tables: [
      postsTable,
      domainPostsTable,
      communicationMessagesTable,
      communicationAttemptsTable,
      siteMenusTable,
      siteMenuItemsTable,
      siteMenuItemMetaTable,
      webcallbackEventsTable,
      webhookSubscriptionsTable,
      webhookDeliveriesTable,
      domainEventsQueueTable,
      termTaxonomyMetaTable,
      mediaTable,
    ],
  });

  await setTextSetting(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_UPDATED_AT_KEY, new Date().toISOString());
}

export async function applyPendingDatabaseMigrations() {
  // Pre-v1 default remains strict no-compat mode. This flow still runs forward
  // schema migrations so operators can repair/install schema safely.
  await applyDatabaseCompatibilityFixes();
}

export async function markDatabaseSchemaCurrent() {
  await setTextSetting(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_UPDATED_AT_KEY, new Date().toISOString());
}
