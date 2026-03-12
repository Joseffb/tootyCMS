import db from "@/lib/db";
import { sql } from "drizzle-orm";
import type { DomainEvent } from "@/lib/domain-events";
import { createId } from "@paralleldrive/cuid2";
import { physicalObjectName, sitePhysicalTableName } from "@/lib/site-physical-table-name";

type QueueStatus = "queued" | "processing" | "processed" | "dead_letter";

type QueueRow = {
  id: string;
  siteId: string;
  event: DomainEvent;
  status: QueueStatus;
  attempts: number;
  availableAt: Date;
  lastError: string | null;
};

const ensuredSites = new Set<string>();

function prefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function networkSitesTableName() {
  return `${prefix()}network_sites`;
}

function quotedIdentifier(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, "\"\"")}"`;
}

export function siteDomainQueueTableName(siteId: string) {
  return sitePhysicalTableName(prefix(), siteId, "domain_events_queue");
}

export function quotedSiteDomainQueueTableName(siteId: string) {
  return quotedIdentifier(siteDomainQueueTableName(siteId));
}

function parseRow(siteId: string, row: any): QueueRow {
  return {
    id: String(row.id),
    siteId,
    event: (typeof row.event === "object" ? row.event : JSON.parse(String(row.event || "{}"))) as DomainEvent,
    status: String(row.status) as QueueStatus,
    attempts: Number(row.attempts || 0),
    availableAt: row.available_at instanceof Date ? row.available_at : new Date(String(row.available_at || "")),
    lastError: row.last_error ? String(row.last_error) : null,
  };
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

export async function listKnownDomainQueueSiteIds() {
  const result = await db.execute<{ id: string }>(
    sql.raw(`SELECT "id" FROM ${quotedIdentifier(networkSitesTableName())}`),
  );
  return (((result as any)?.rows ?? []) as Array<{ id?: string }>)
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);
}

export async function ensureSiteDomainQueueTable(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required to ensure the site event queue.");
  }
  if (ensuredSites.has(normalizedSiteId)) return;

  const table = quotedSiteDomainQueueTableName(normalizedSiteId);
  const tableName = siteDomainQueueTableName(normalizedSiteId);
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id text CONSTRAINT "${physicalObjectName(tableName, "pkey")}" PRIMARY KEY,
        event jsonb NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        attempts integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(),
        last_error text NULL,
        processed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "${tableName}_status_due_idx" ON ${table} (status, available_at)`),
  );
  ensuredSites.add(normalizedSiteId);
}

export async function migrateLegacySharedDomainQueueToSiteQueues() {
  const legacyTableName = `${prefix()}domain_events_queue`;
  const existing = await listExistingTables([legacyTableName]);
  if (!existing.has(legacyTableName)) return;

  const rows = await db.execute<{
    id: string;
    event: unknown;
    status: string;
    attempts: number;
    available_at: Date | string;
    last_error: string | null;
    processed_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(sql.raw(`
    SELECT id, event, status, attempts, available_at, last_error, processed_at, created_at, updated_at
    FROM ${quotedIdentifier(legacyTableName)}
    ORDER BY created_at ASC
  `));

  for (const row of ((rows as any)?.rows ?? []) as Array<Record<string, unknown>>) {
    const event =
      typeof row.event === "object" && row.event
        ? (row.event as Record<string, unknown>)
        : JSON.parse(String(row.event || "{}"));
    const siteId = String(event.siteId || "").trim();
    if (!siteId) continue;

    await ensureSiteDomainQueueTable(siteId);
    const table = sql.raw(quotedSiteDomainQueueTableName(siteId));
    await db.execute(sql`
      INSERT INTO ${table}
        (id, event, status, attempts, available_at, last_error, processed_at, created_at, updated_at)
      VALUES
        (
          ${String(row.id || "")},
          ${JSON.stringify(event)}::jsonb,
          ${String(row.status || "queued")},
          ${Number(row.attempts || 0)},
          ${row.available_at ? new Date(String(row.available_at)) : new Date()},
          ${row.last_error ? String(row.last_error) : null},
          ${row.processed_at ? new Date(String(row.processed_at)) : null},
          ${row.created_at ? new Date(String(row.created_at)) : new Date()},
          ${row.updated_at ? new Date(String(row.updated_at)) : new Date()}
        )
      ON CONFLICT (id) DO NOTHING
    `);
  }
}

export async function enqueueDomainEvent(event: DomainEvent) {
  const siteId = String(event.siteId || "").trim();
  if (!siteId) {
    throw new Error("siteId is required to enqueue a domain event.");
  }
  await ensureSiteDomainQueueTable(siteId);
  const table = sql.raw(quotedSiteDomainQueueTableName(siteId));
  const id = createId();
  await db.execute(sql`
    INSERT INTO ${table}
    (id, event, status, attempts, available_at, created_at, updated_at)
    VALUES
    (${id}, ${JSON.stringify(event)}::jsonb, 'queued', 0, now(), now(), now())
  `);
  return id;
}

export async function claimDomainEventBatch(siteId: string, limit = 25) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return [];
  await ensureSiteDomainQueueTable(normalizedSiteId);
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  const res = await db.execute(sql.raw(`
    WITH claimed AS (
      SELECT id
      FROM ${quotedSiteDomainQueueTableName(normalizedSiteId)}
      WHERE status = 'queued'
        AND available_at <= now()
      ORDER BY created_at ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${quotedSiteDomainQueueTableName(normalizedSiteId)} q
    SET
      status = 'processing',
      attempts = q.attempts + 1,
      updated_at = now()
    FROM claimed
    WHERE q.id = claimed.id
    RETURNING q.*
  `));
  return ((res as any)?.rows || []).map((row: any) => parseRow(normalizedSiteId, row));
}

export async function markDomainEventProcessed(siteId: string, id: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return;
  const table = sql.raw(quotedSiteDomainQueueTableName(normalizedSiteId));
  await db.execute(sql`
    UPDATE ${table}
    SET status = 'processed', processed_at = now(), updated_at = now()
    WHERE id = ${id}
  `);
}

export async function markDomainEventFailed(siteId: string, id: string, attempts: number, errorMessage: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return;
  const table = sql.raw(quotedSiteDomainQueueTableName(normalizedSiteId));
  const maxAttempts = 8;
  const backoffSeconds = Math.min(300, 2 ** Math.max(1, attempts));
  if (attempts >= maxAttempts) {
    await db.execute(sql`
      UPDATE ${table}
      SET
        status = 'dead_letter',
        last_error = ${errorMessage.slice(0, 2000)},
        updated_at = now()
      WHERE id = ${id}
    `);
    return;
  }

  await db.execute(sql`
    UPDATE ${table}
    SET
      status = 'queued',
      available_at = now() + (${backoffSeconds} * interval '1 second'),
      last_error = ${errorMessage.slice(0, 2000)},
      updated_at = now()
    WHERE id = ${id}
  `);
}
