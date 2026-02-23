import db from "@/lib/db";
import { sql } from "drizzle-orm";
import type { AnalyticsEvent } from "@/lib/analytics-events";
import { createId } from "@paralleldrive/cuid2";

type QueueStatus = "queued" | "processing" | "processed" | "dead_letter";

type QueueRow = {
  id: string;
  event: AnalyticsEvent;
  status: QueueStatus;
  attempts: number;
  availableAt: Date;
  lastError: string | null;
};

let ensured = false;

function prefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function tableName() {
  return `${prefix()}analytics_events_queue`;
}

function quotedTableName() {
  return `"${tableName().replace(/"/g, "\"\"")}"`;
}

function parseRow(row: any): QueueRow {
  return {
    id: String(row.id),
    event: (typeof row.event === "object" ? row.event : JSON.parse(String(row.event || "{}"))) as AnalyticsEvent,
    status: String(row.status) as QueueStatus,
    attempts: Number(row.attempts || 0),
    availableAt: row.available_at instanceof Date ? row.available_at : new Date(String(row.available_at || "")),
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export async function ensureAnalyticsQueueTable() {
  if (ensured) return;
  const table = quotedTableName();
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id text PRIMARY KEY,
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
    sql.raw(`CREATE INDEX IF NOT EXISTS "${tableName()}_status_due_idx" ON ${table} (status, available_at)`),
  );
  ensured = true;
}

export async function enqueueAnalyticsEvent(event: AnalyticsEvent) {
  await ensureAnalyticsQueueTable();
  const table = sql.raw(quotedTableName());
  const id = createId();
  await db.execute(sql`
    INSERT INTO ${table}
    (id, event, status, attempts, available_at, created_at, updated_at)
    VALUES
    (${id}, ${JSON.stringify(event)}::jsonb, 'queued', 0, now(), now(), now())
  `);
  return id;
}

export async function claimAnalyticsEventBatch(limit = 25) {
  await ensureAnalyticsQueueTable();
  const table = sql.raw(quotedTableName());
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  const res = await db.execute(sql.raw(`
    WITH claimed AS (
      SELECT id
      FROM ${quotedTableName()}
      WHERE status = 'queued'
        AND available_at <= now()
      ORDER BY created_at ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${quotedTableName()} q
    SET
      status = 'processing',
      attempts = q.attempts + 1,
      updated_at = now()
    FROM claimed
    WHERE q.id = claimed.id
    RETURNING q.*
  `));
  return ((res as any)?.rows || []).map(parseRow);
}

export async function markAnalyticsEventProcessed(id: string) {
  const table = sql.raw(quotedTableName());
  await db.execute(sql`
    UPDATE ${table}
    SET status = 'processed', processed_at = now(), updated_at = now()
    WHERE id = ${id}
  `);
}

export async function markAnalyticsEventFailed(id: string, attempts: number, errorMessage: string) {
  const table = sql.raw(quotedTableName());
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
