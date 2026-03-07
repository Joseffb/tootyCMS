import db from "@/lib/db";
import { sql } from "drizzle-orm";
import { trace } from "@/lib/debug";
import { getTextSetting, setTextSetting } from "@/lib/cms-config";
import { isCompatModeEnabled } from "@/lib/compat-mode";
import { ensureSiteSettingsTable } from "@/lib/site-settings-tables";
import { ensureSiteUserTables } from "@/lib/site-user-tables";
import { ensureSiteCommentTables } from "@/lib/site-comment-tables";
import { ensureSiteDataDomainTable } from "@/lib/site-data-domain-registry";
import { ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import { ensureSiteDomainTypeTables } from "@/lib/site-domain-type-tables";
import { ensureSiteMediaTable } from "@/lib/site-media-tables";
import { ensureSiteMenuTables } from "@/lib/site-menu-tables";
import { ensureSiteTaxonomyTables } from "@/lib/site-taxonomy-tables";

export type MissingDbColumn = {
  table: string;
  column: string;
};

export const DB_SCHEMA_VERSION_KEY = "db_schema_version";
export const DB_SCHEMA_TARGET_VERSION_KEY = "db_schema_target_version";
export const DB_SCHEMA_UPDATED_AT_KEY = "db_schema_updated_at";
export const TARGET_DB_SCHEMA_VERSION = "2026.03.05.2";

const REQUIRED_NETWORK_TABLE_SUFFIXES = [
  "network_accounts",
  "network_communication_attempts",
  "network_communication_messages",
  "network_rbac_roles",
  "network_sessions",
  "network_sites",
  "network_system_settings",
  "network_user_meta",
  "network_users",
  "network_verification_tokens",
  "network_webcallback_events",
  "network_webhook_deliveries",
  "network_webhook_subscriptions",
] as const;

const DISALLOWED_SHARED_OR_LEGACY_TABLE_SUFFIXES = [
  "accounts",
  "categories",
  "comments",
  "data_domains",
  "domain_events_queue",
  "domain_post_meta",
  "domain_posts",
  "examples",
  "post_categories",
  "post_meta",
  "post_tags",
  "posts",
  "rbac_roles",
  "sessions",
  "site_comments",
  "site_communication_attempts",
  "site_communication_messages",
  "site_data_domain_assignments",
  "site_data_domains",
  "site_domain_post_meta",
  "site_domain_posts",
  "site_examples",
  "site_media",
  "site_menu_item_meta",
  "site_menu_items",
  "site_menus",
  "site_posts",
  "site_term_relationships",
  "site_term_taxonomies",
  "site_term_taxonomy_domains",
  "site_term_taxonomy_meta",
  "site_terms",
  "site_webcallback_events",
  "site_webhook_deliveries",
  "site_webhook_subscriptions",
  "sites",
  "system_settings",
  "tags",
  "term_relationships",
  "term_taxonomies",
  "term_taxonomy_domains",
  "term_taxonomy_meta",
  "terms",
  "user_meta",
  "users",
  "verificationTokens",
] as const;

const OBSOLETE_REGISTRY_TABLE_SUFFIXES = [
  "site_comment_table_registry",
  "site_settings_table_registry",
  "site_user_table_registry",
] as const;

async function safeGetSetting(key: string, fallback: string) {
  try {
    return await getTextSetting(key, fallback);
  } catch {
    return fallback;
  }
}

function getPrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function quoteIdentifier(input: string) {
  return `"${input.replace(/"/g, "\"\"")}"`;
}

function stableIdentifierHash(input: string) {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const modulo = BigInt("0xffffffffffffffff");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & modulo;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

export function networkSequenceName(tableName: string, columnName = "id") {
  const readable = `${String(tableName || "").trim()}_${String(columnName || "").trim()}_seq`;
  if (readable.length <= 63) {
    return readable;
  }

  const hash = stableIdentifierHash(readable);
  const suffix = `_${hash}_seq`;
  const maxBaseLength = 63 - suffix.length;
  return `${readable.slice(0, maxBaseLength)}${suffix}`;
}

async function ensureOwnedSequence(tableName: string, columnName = "id") {
  const sequenceName = networkSequenceName(tableName, columnName);
  await db.execute(sql.raw(`
    ALTER SEQUENCE ${quoteIdentifier(sequenceName)}
    OWNED BY ${quoteIdentifier(tableName)}.${quoteIdentifier(columnName)}
  `));
  return sequenceName;
}

async function listExistingTables(tableNames: string[]) {
  if (!tableNames.length) return new Set<string>();
  const tableSql = sql.join(tableNames.map((name) => sql`${name}`), sql`,`);
  const result = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${tableSql})
  `);
  return new Set(((result as any)?.rows ?? []).map((row: any) => String(row.table_name)));
}

async function listKnownSiteIds() {
  const prefix = getPrefix();
  const sitesTable = `${prefix}network_sites`;
  const result = await db.execute<{ id: string }>(sql.raw(`SELECT "id" FROM ${quoteIdentifier(sitesTable)}`));
  return (((result as any)?.rows ?? []) as Array<{ id?: string }>).map((row) => String(row.id || "").trim()).filter(Boolean);
}

async function ensureSiteScopedFeatureTables(siteId: string) {
  await ensureSiteMediaTable(siteId);
  await ensureSiteMenuTables(siteId);
  await ensureSiteSettingsTable(siteId);
  await ensureSiteUserTables(siteId);
  await ensureSiteCommentTables(siteId);
  await ensureSiteDataDomainTable(siteId);
  await ensureDefaultCoreDataDomains(siteId);
  await ensureSiteTaxonomyTables(siteId);
  await ensureSiteDomainTypeTables(siteId, "post");
  await ensureSiteDomainTypeTables(siteId, "page");
}

export async function getDatabaseHealthReport() {
  const prefix = getPrefix();
  const requiredTables = REQUIRED_NETWORK_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`);
  const existingRequired = await listExistingTables(requiredTables);
  const missingTables = requiredTables.filter((name) => !existingRequired.has(name));

  const disallowedTables = DISALLOWED_SHARED_OR_LEGACY_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`);
  const disallowedFound = Array.from(await listExistingTables(disallowedTables));

  const obsoleteRegistryTables = OBSOLETE_REGISTRY_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`);
  const obsoleteRegistryFound = Array.from(await listExistingTables(obsoleteRegistryTables));

  const missing: MissingDbColumn[] = [];
  if (missingTables.length > 0) {
    trace("db", "database update required", { missingTables });
  }

  const currentVersion = await safeGetSetting(DB_SCHEMA_VERSION_KEY, "");
  const targetVersion = TARGET_DB_SCHEMA_VERSION;
  const versionBehind = currentVersion !== targetVersion;
  const compatMode = isCompatModeEnabled();
  const migrationRequired =
    missingTables.length > 0 ||
    disallowedFound.length > 0 ||
    obsoleteRegistryFound.length > 0 ||
    versionBehind;

  const pending = [
    ...(missingTables.length
      ? [{
          id: "2026.03.05.2-network-tables",
          title: "Create required network tables",
          reason: "Minimal network tables are missing for the current release contract.",
        }]
      : []),
    ...(disallowedFound.length
      ? [{
          id: "2026.03.05.2-drop-shared-feature-tables",
          title: "Drop shared feature tables",
          reason: "Shared or legacy feature tables still exist and violate the site-physical storage contract.",
        }]
      : []),
    ...(obsoleteRegistryFound.length
      ? [{
          id: "2026.03.05.2-drop-obsolete-registries",
          title: "Drop obsolete registry tables",
          reason: "Legacy registry tables are obsolete under deterministic site table naming.",
        }]
      : []),
    ...(versionBehind
      ? [{
          id: "2026.03.05.2-version",
          title: "Record schema version",
          reason: "Installed schema version is behind the current target.",
        }]
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
    obsoleteRegistryFound,
  };
}

export async function applyDatabaseCompatibilityFixes() {
  const prefix = getPrefix();
  const networkUsersTable = `${prefix}network_users`;
  const networkUserMetaTable = `${prefix}network_user_meta`;
  const networkSessionsTable = `${prefix}network_sessions`;
  const networkVerificationTokensTable = `${prefix}network_verification_tokens`;
  const networkSystemSettingsTable = `${prefix}network_system_settings`;
  const networkRbacRolesTable = `${prefix}network_rbac_roles`;
  const networkSitesTable = `${prefix}network_sites`;
  const networkAccountsTable = `${prefix}network_accounts`;
  const networkCommunicationMessagesTable = `${prefix}network_communication_messages`;
  const networkCommunicationAttemptsTable = `${prefix}network_communication_attempts`;
  const networkWebcallbackEventsTable = `${prefix}network_webcallback_events`;
  const networkWebhookSubscriptionsTable = `${prefix}network_webhook_subscriptions`;
  const networkWebhookDeliveriesTable = `${prefix}network_webhook_deliveries`;
  const networkUserMetaIdSequence = networkSequenceName(networkUserMetaTable);
  const networkCommunicationAttemptsIdSequence = networkSequenceName(networkCommunicationAttemptsTable);
  const networkWebcallbackEventsIdSequence = networkSequenceName(networkWebcallbackEventsTable);
  const networkWebhookSubscriptionsIdSequence = networkSequenceName(networkWebhookSubscriptionsTable);

  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdentifier(networkUserMetaIdSequence)}`));
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdentifier(networkCommunicationAttemptsIdSequence)}`));
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdentifier(networkWebcallbackEventsIdSequence)}`));
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdentifier(networkWebhookSubscriptionsIdSequence)}`));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkUsersTable)} (
      "id" text PRIMARY KEY,
      "name" text NULL,
      "username" text NULL,
      "gh_username" text NULL,
      "email" text NOT NULL UNIQUE,
      "emailVerified" timestamp NULL,
      "image" text NULL,
      "authProvider" text NOT NULL DEFAULT 'native',
      "passwordHash" text NULL,
      "role" text NOT NULL DEFAULT 'author',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkUserMetaTable)} (
      "id" integer PRIMARY KEY DEFAULT nextval('${networkUserMetaIdSequence}'::regclass),
      "userId" text NOT NULL REFERENCES ${quoteIdentifier(networkUsersTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "key" text NOT NULL,
      "value" text NOT NULL DEFAULT '',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      UNIQUE ("userId", "key")
    )
  `));
  await ensureOwnedSequence(networkUserMetaTable);
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkSessionsTable)} (
      "sessionToken" text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES ${quoteIdentifier(networkUsersTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "expires" timestamp NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkVerificationTokensTable)} (
      "identifier" text NOT NULL,
      "token" text NOT NULL UNIQUE,
      "expires" timestamp NOT NULL,
      PRIMARY KEY ("identifier", "token")
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkSystemSettingsTable)} (
      "key" text PRIMARY KEY,
      "value" text NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkRbacRolesTable)} (
      "role" text PRIMARY KEY,
      "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "isSystem" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkSitesTable)} (
      "id" text PRIMARY KEY,
      "name" text NULL,
      "description" text NULL,
      "logo" text NULL DEFAULT '',
      "font" text NOT NULL DEFAULT 'font-cal',
      "image" text NULL DEFAULT '/tooty-soccer.svg',
      "imageBlurhash" text NULL DEFAULT '',
      "subdomain" text UNIQUE,
      "customDomain" text UNIQUE,
      "message404" text NULL DEFAULT 'Blimey! You''ve found a page that doesn''t exist.',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "userId" text NULL REFERENCES ${quoteIdentifier(networkUsersTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "seriesCards" jsonb NULL DEFAULT '[]'::jsonb,
      "layout" text NULL DEFAULT 'default',
      "heroImage" text NULL,
      "heroTitle" text NULL,
      "heroSubtitle" text NULL,
      "heroCtaText" text NULL,
      "heroCtaUrl" text NULL,
      "isPrimary" boolean NOT NULL DEFAULT false
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkAccountsTable)} (
      "userId" text NOT NULL REFERENCES ${quoteIdentifier(networkUsersTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "type" text NOT NULL,
      "provider" text NOT NULL,
      "providerAccountId" text NOT NULL,
      "refresh_token" text NULL,
      "refresh_token_expires_in" integer NULL,
      "access_token" text NULL,
      "expires_at" integer NULL,
      "token_type" text NULL,
      "scope" text NULL,
      "id_token" text NULL,
      "session_state" text NULL,
      "oauth_token_secret" text NULL,
      "oauth_token" text NULL,
      PRIMARY KEY ("provider", "providerAccountId")
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkCommunicationMessagesTable)} (
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
      "createdByUserId" text NULL REFERENCES ${quoteIdentifier(networkUsersTable)}("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkCommunicationAttemptsTable)} (
      "id" integer PRIMARY KEY DEFAULT nextval('${networkCommunicationAttemptsIdSequence}'::regclass),
      "messageId" text NOT NULL REFERENCES ${quoteIdentifier(networkCommunicationMessagesTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "providerId" text NOT NULL,
      "eventId" text NULL,
      "status" text NOT NULL,
      "error" text NULL,
      "response" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `));
  await ensureOwnedSequence(networkCommunicationAttemptsTable);
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkWebcallbackEventsTable)} (
      "id" integer PRIMARY KEY DEFAULT nextval('${networkWebcallbackEventsIdSequence}'::regclass),
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
    )
  `));
  await ensureOwnedSequence(networkWebcallbackEventsTable);
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkWebhookSubscriptionsTable)} (
      "id" integer PRIMARY KEY DEFAULT nextval('${networkWebhookSubscriptionsIdSequence}'::regclass),
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
    )
  `));
  await ensureOwnedSequence(networkWebhookSubscriptionsTable);
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(networkWebhookDeliveriesTable)} (
      "id" text PRIMARY KEY,
      "subscriptionId" integer NOT NULL REFERENCES ${quoteIdentifier(networkWebhookSubscriptionsTable)}("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
    )
  `));

  const siteIds = await listKnownSiteIds().catch(() => []);
  for (const siteId of siteIds) {
    await ensureSiteScopedFeatureTables(siteId);
  }

  const dropTables = [
    ...DISALLOWED_SHARED_OR_LEGACY_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`),
    ...OBSOLETE_REGISTRY_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`),
  ];
  for (const tableName of dropTables) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)} CASCADE`));
  }

  trace("db", "database compatibility fixes applied", {
    tables: [
      ...REQUIRED_NETWORK_TABLE_SUFFIXES.map((suffix) => `${prefix}${suffix}`),
      ...dropTables,
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
