import db from "@/lib/db";
import { trace } from "@/lib/debug";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  SCHEDULES_ENABLED_KEY,
  SCHEDULES_PING_SITEMAP_KEY,
  getBooleanSetting,
  getSiteUrlSetting,
  getSiteUrlSettingForSite,
} from "@/lib/cms-config";

export type SchedulerOwnerType = "plugin" | "theme" | "core";
export type SchedulerStatus = "success" | "error" | "skipped";

export type ScheduleEntry = {
  id: string;
  ownerType: SchedulerOwnerType;
  ownerId: string;
  siteId: string | null;
  name: string;
  actionKey: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  runEveryMinutes: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduleMutationActor = {
  isAdmin: boolean;
  ownerType?: SchedulerOwnerType;
  ownerId?: string;
};

type CreateScheduleInput = {
  siteId?: string | null;
  name: string;
  actionKey: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
  runEveryMinutes?: number;
  nextRunAt?: Date;
};

type UpdateScheduleInput = Partial<CreateScheduleInput>;

let ensured = false;

function getPrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function tableName() {
  return `${getPrefix()}scheduled_actions`;
}

function quotedTableName() {
  return `"${tableName().replace(/"/g, "\"\"")}"`;
}

function lockKeyName() {
  return `${getPrefix()}scheduler_lock`;
}

function toRunEveryMinutes(value: unknown, fallback = 60) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(24 * 60, Math.trunc(n)));
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toDate(value: unknown, fallback = new Date()) {
  const d = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function mapRow(row: any): ScheduleEntry {
  return {
    id: String(row.id),
    ownerType: String(row.owner_type) as SchedulerOwnerType,
    ownerId: String(row.owner_id),
    siteId: row.site_id ? String(row.site_id) : null,
    name: String(row.name || ""),
    actionKey: String(row.action_key || ""),
    payload: parsePayload(row.payload),
    enabled: Boolean(row.enabled),
    runEveryMinutes: Number(row.run_every_minutes || 60),
    nextRunAt: toDate(row.next_run_at),
    lastRunAt: row.last_run_at ? toDate(row.last_run_at) : null,
    lastStatus: row.last_status ? String(row.last_status) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export async function ensureSchedulerTables() {
  if (ensured) return;
  const table = quotedTableName();
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id text PRIMARY KEY,
        owner_type text NOT NULL,
        owner_id text NOT NULL,
        site_id text NULL,
        name text NOT NULL,
        action_key text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        run_every_minutes integer NOT NULL DEFAULT 60,
        next_run_at timestamptz NOT NULL DEFAULT now(),
        last_run_at timestamptz NULL,
        last_status text NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${tableName()}_due_idx" ON ${table} (enabled, next_run_at)`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "${tableName()}_owner_idx" ON ${table} (owner_type, owner_id)`,
    ),
  );
  ensured = true;
}

export async function createScheduleEntry(
  ownerType: SchedulerOwnerType,
  ownerId: string,
  input: CreateScheduleInput,
) {
  await ensureSchedulerTables();
  const id = createId();
  const name = String(input.name || "").trim();
  const actionKey = String(input.actionKey || "").trim();
  if (!name) throw new Error("Schedule name is required");
  if (!actionKey) throw new Error("Schedule action key is required");

  const table = sql.raw(quotedTableName());
  await db.execute(sql`
    INSERT INTO ${table}
    (id, owner_type, owner_id, site_id, name, action_key, payload, enabled, run_every_minutes, next_run_at, created_at, updated_at)
    VALUES
    (
      ${id},
      ${ownerType},
      ${ownerId},
      ${input.siteId || null},
      ${name},
      ${actionKey},
      ${JSON.stringify(input.payload || {})}::jsonb,
      ${input.enabled ?? true},
      ${toRunEveryMinutes(input.runEveryMinutes, 60)},
      ${toDate(input.nextRunAt, new Date())},
      now(),
      now()
    )
  `);

  const created = await getScheduleEntryById(id);
  if (!created) throw new Error("Failed to create schedule");
  return created;
}

export async function getScheduleEntryById(id: string) {
  await ensureSchedulerTables();
  const table = sql.raw(quotedTableName());
  const res = await db.execute(sql`SELECT * FROM ${table} WHERE id = ${id} LIMIT 1`);
  const row = (res as any)?.rows?.[0];
  return row ? mapRow(row) : null;
}

export async function listScheduleEntries(filter?: {
  ownerType?: SchedulerOwnerType;
  ownerId?: string;
  includeDisabled?: boolean;
}) {
  await ensureSchedulerTables();
  const table = sql.raw(quotedTableName());
  const where: any[] = [];
  if (!filter?.includeDisabled) where.push(sql`enabled = true`);
  if (filter?.ownerType) where.push(sql`owner_type = ${filter.ownerType}`);
  if (filter?.ownerId) where.push(sql`owner_id = ${filter.ownerId}`);
  const whereClause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const res = await db.execute(sql`SELECT * FROM ${table} ${whereClause} ORDER BY next_run_at ASC NULLS LAST, created_at DESC`);
  return ((res as any)?.rows || []).map(mapRow);
}

function canMutate(entry: ScheduleEntry, actor: ScheduleMutationActor) {
  if (actor.isAdmin) return true;
  return actor.ownerType === entry.ownerType && actor.ownerId === entry.ownerId;
}

export async function updateScheduleEntry(id: string, input: UpdateScheduleInput, actor: ScheduleMutationActor) {
  const existing = await getScheduleEntryById(id);
  if (!existing) throw new Error("Schedule not found");
  if (!canMutate(existing, actor)) throw new Error("Not authorized");

  const next = {
    siteId: input.siteId === undefined ? existing.siteId : input.siteId || null,
    name: input.name === undefined ? existing.name : String(input.name || "").trim(),
    actionKey: input.actionKey === undefined ? existing.actionKey : String(input.actionKey || "").trim(),
    payload: input.payload === undefined ? existing.payload : input.payload || {},
    enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
    runEveryMinutes:
      input.runEveryMinutes === undefined
        ? existing.runEveryMinutes
        : toRunEveryMinutes(input.runEveryMinutes, existing.runEveryMinutes),
    nextRunAt: input.nextRunAt === undefined ? existing.nextRunAt : toDate(input.nextRunAt, existing.nextRunAt),
  };
  if (!next.name) throw new Error("Schedule name is required");
  if (!next.actionKey) throw new Error("Schedule action key is required");

  const table = sql.raw(quotedTableName());
  await db.execute(sql`
    UPDATE ${table}
    SET
      site_id = ${next.siteId},
      name = ${next.name},
      action_key = ${next.actionKey},
      payload = ${JSON.stringify(next.payload)}::jsonb,
      enabled = ${next.enabled},
      run_every_minutes = ${next.runEveryMinutes},
      next_run_at = ${next.nextRunAt},
      updated_at = now()
    WHERE id = ${id}
  `);
  return getScheduleEntryById(id);
}

export async function deleteScheduleEntry(id: string, actor: ScheduleMutationActor) {
  const existing = await getScheduleEntryById(id);
  if (!existing) return { ok: true };
  if (!canMutate(existing, actor)) throw new Error("Not authorized");
  const table = sql.raw(quotedTableName());
  await db.execute(sql`DELETE FROM ${table} WHERE id = ${id}`);
  return { ok: true };
}

export async function acquireSchedulerLock() {
  const res = await db.execute(sql`select pg_try_advisory_lock(hashtext(${lockKeyName()})) as acquired`);
  return Boolean((res as any)?.rows?.[0]?.acquired);
}

export async function releaseSchedulerLock() {
  await db.execute(sql`select pg_advisory_unlock(hashtext(${lockKeyName()}))`);
}

async function runCoreAction(entry: ScheduleEntry): Promise<{ status: SchedulerStatus; error?: string }> {
  const action = entry.actionKey;

  if (action === "core.ping_sitemap" || action === "ping_sitemap") {
    const pingEnabled = await getBooleanSetting(SCHEDULES_PING_SITEMAP_KEY, false);
    if (!pingEnabled) return { status: "skipped", error: "sitemap ping disabled in settings" };

    const siteUrl = entry.siteId
      ? (await getSiteUrlSettingForSite(entry.siteId, "")).value.trim()
      : (await getSiteUrlSetting()).value.trim();
    if (!siteUrl) return { status: "skipped", error: "site url not configured" };

    const target = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    const res = await fetch(target, { method: "GET", cache: "no-store" });
    if (!res.ok) return { status: "error", error: `sitemap ping failed: ${res.status}` };
    return { status: "success" };
  }

  if (action === "core.http_ping" || action === "http_ping") {
    const url = String(entry.payload?.url || "").trim();
    if (!url) return { status: "error", error: "payload.url is required" };
    const method = String(entry.payload?.method || "GET").toUpperCase();
    const res = await fetch(url, { method, cache: "no-store" });
    if (!res.ok) return { status: "error", error: `http ping failed: ${res.status}` };
    return { status: "success" };
  }

  return { status: "skipped", error: `core action not found: ${action}` };
}

async function runExtensionAction(entry: ScheduleEntry): Promise<{ status: SchedulerStatus; error?: string }> {
  if (entry.ownerType !== "plugin") {
    return { status: "skipped", error: `handler not found for owner type: ${entry.ownerType}` };
  }

  try {
    const { createKernelForRequest } = await import("@/lib/plugin-runtime");
    const kernel = await createKernelForRequest();
    const handlers = kernel.getPluginScheduleHandlers(entry.ownerId);
    const handler = handlers.find((item) => item.id === entry.actionKey);
    if (!handler) {
      return { status: "skipped", error: `handler not found: ${entry.ownerId}:${entry.actionKey}` };
    }
    await handler.run({ siteId: entry.siteId, payload: entry.payload });
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDueSchedules(limit = 25) {
  await ensureSchedulerTables();
  const enabled = await getBooleanSetting(SCHEDULES_ENABLED_KEY, false);
  if (!enabled) return { ran: 0, skipped: 0, errors: 0, message: "schedules disabled" };

  const table = sql.raw(quotedTableName());
  const now = new Date();
  const dueRes = await db.execute(sql`
    SELECT * FROM ${table}
    WHERE enabled = true
      AND next_run_at <= ${now}
    ORDER BY next_run_at ASC
    LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}
  `);
  const due = ((dueRes as any)?.rows || []).map(mapRow);

  let ran = 0;
  let skipped = 0;
  let errors = 0;
  for (const entry of due) {
    const result =
      entry.ownerType === "core" ? await runCoreAction(entry) : await runExtensionAction(entry);
    const nextRunAt = new Date(Date.now() + entry.runEveryMinutes * 60 * 1000);

    await db.execute(sql`
      UPDATE ${table}
      SET
        last_run_at = now(),
        last_status = ${result.status},
        last_error = ${result.error || ""},
        next_run_at = ${nextRunAt},
        updated_at = now()
      WHERE id = ${entry.id}
    `);

    ran += 1;
    if (result.status === "skipped") skipped += 1;
    if (result.status === "error") errors += 1;
  }

  trace("scheduler", "due schedules processed", { due: due.length, ran, skipped, errors });
  return { ran, skipped, errors, message: "ok" };
}
