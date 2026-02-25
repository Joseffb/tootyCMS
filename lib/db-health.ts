import db from "@/lib/db";
import { sql } from "drizzle-orm";
import { trace } from "@/lib/debug";
import { getTextSetting, setTextSetting } from "@/lib/cms-config";

type RequiredColumn = {
  tableSuffix: "posts" | "domain_posts";
  column: "image" | "imageBlurhash";
};

export type MissingDbColumn = {
  table: string;
  column: string;
};

export const DB_SCHEMA_VERSION_KEY = "db_schema_version";
export const DB_SCHEMA_TARGET_VERSION_KEY = "db_schema_target_version";
export const DB_SCHEMA_UPDATED_AT_KEY = "db_schema_updated_at";
export const TARGET_DB_SCHEMA_VERSION = "2026.02.25.2";

async function safeGetSetting(key: string, fallback: string) {
  try {
    return await getTextSetting(key, fallback);
  } catch {
    return fallback;
  }
}

const REQUIRED_COLUMNS: RequiredColumn[] = [
  { tableSuffix: "posts", column: "image" },
  { tableSuffix: "posts", column: "imageBlurhash" },
  { tableSuffix: "domain_posts", column: "image" },
  { tableSuffix: "domain_posts", column: "imageBlurhash" },
];

const REQUIRED_TABLE_SUFFIXES = [
  "communication_messages",
  "communication_attempts",
  "webcallback_events",
  "webhook_subscriptions",
  "webhook_deliveries",
  "domain_events_queue",
] as const;

function getPrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function toTableName(suffix: RequiredColumn["tableSuffix"]) {
  return `${getPrefix()}${suffix}`;
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

  if (missing.length > 0 || missingTables.length > 0) {
    trace("db", "database update required", { missingColumns: missing, missingTables });
  }

  const currentVersion = await safeGetSetting(DB_SCHEMA_VERSION_KEY, "");
  const targetVersion =
    (await safeGetSetting(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION)) ||
    TARGET_DB_SCHEMA_VERSION;
  const versionBehind = currentVersion !== targetVersion;
  const migrationRequired = missing.length > 0 || missingTables.length > 0 || versionBehind;
  const pending = [
    ...(missingTables.length > 0
      ? [
          {
            id: "2026.02.25.2-communication-webhook-tables",
            title: "Create communication/webhook queue and callback audit tables",
            reason:
              "Missing communication_messages, communication_attempts, webcallback_events, webhook_subscriptions, webhook_deliveries, and/or domain_events_queue tables.",
          },
        ]
      : []),
    ...(missing.length > 0
      ? [
          {
            id: "2026.02.24.1-columns",
            title: "Add image columns to legacy content tables",
            reason: "Missing required image/imageBlurhash columns.",
          },
        ]
      : []),
    ...(versionBehind
      ? [
          {
            id: "2026.02.25.2-version",
            title: "Record schema version",
            reason: "Installed schema version is not at current target.",
          },
        ]
      : []),
  ];

  return {
    ok: !migrationRequired,
    migrationRequired,
    pending,
    currentVersion: currentVersion || "(untracked)",
    targetVersion,
    missing,
    missingTables,
  };
}

function quoteIdentifier(input: string) {
  return `"${input.replace(/"/g, "\"\"")}"`;
}

export async function applyDatabaseCompatibilityFixes() {
  const prefix = getPrefix();
  const postsTable = toTableName("posts");
  const domainPostsTable = toTableName("domain_posts");
  const communicationMessagesTable = `${prefix}communication_messages`;
  const communicationAttemptsTable = `${prefix}communication_attempts`;
  const webcallbackEventsTable = `${prefix}webcallback_events`;
  const webhookSubscriptionsTable = `${prefix}webhook_subscriptions`;
  const webhookDeliveriesTable = `${prefix}webhook_deliveries`;
  const domainEventsQueueTable = `${prefix}domain_events_queue`;

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
      `CREATE INDEX IF NOT EXISTS "${prefix}term_relationships_object_id_idx" ON ${quoteIdentifier(`${prefix}term_relationships`)} ("objectId")`,
    ),
  );

  trace("db", "database compatibility fixes applied", {
    tables: [
      postsTable,
      domainPostsTable,
      communicationMessagesTable,
      communicationAttemptsTable,
      webcallbackEventsTable,
      webhookSubscriptionsTable,
      webhookDeliveriesTable,
      domainEventsQueueTable,
    ],
  });

  await setTextSetting(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_UPDATED_AT_KEY, new Date().toISOString());
}

export async function applyPendingDatabaseMigrations() {
  await applyDatabaseCompatibilityFixes();
}

export async function markDatabaseSchemaCurrent() {
  await setTextSetting(DB_SCHEMA_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_TARGET_VERSION_KEY, TARGET_DB_SCHEMA_VERSION);
  await setTextSetting(DB_SCHEMA_UPDATED_AT_KEY, new Date().toISOString());
}
