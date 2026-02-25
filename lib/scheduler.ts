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
import { purgeCommunicationQueue, retryPendingCommunications } from "@/lib/communications";
import { purgeWebcallbackEvents } from "@/lib/webcallbacks";
import { retryPendingWebhookDeliveries } from "@/lib/webhook-delivery";
import { setDomainPostPublishedState } from "@/lib/content-lifecycle";

export type SchedulerOwnerType = "plugin" | "theme" | "core";
export type SchedulerStatus = "success" | "error" | "skipped" | "blocked" | "dead_letter";
export type SchedulerTrigger = "cron" | "manual";

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
  maxRetries: number;
  backoffBaseSeconds: number;
  retryCount: number;
  deadLettered: boolean;
  deadLetteredAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SchedulerRunRecord = {
  id: string;
  scheduleId: string;
  trigger: SchedulerTrigger;
  status: SchedulerStatus;
  error: string | null;
  durationMs: number;
  retryAttempt: number;
  payload: Record<string, unknown>;
  createdAt: Date;
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
  maxRetries?: number;
  backoffBaseSeconds?: number;
  nextRunAt?: Date | null;
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

function runTableName() {
  return `${getPrefix()}scheduled_action_runs`;
}

function quotedTableName() {
  return `"${tableName().replace(/"/g, "\"\"")}"`;
}

function quotedRunTableName() {
  return `"${runTableName().replace(/"/g, "\"\"")}"`;
}

function lockKeyName() {
  return `${getPrefix()}scheduler_lock`;
}

function toRunEveryMinutes(value: unknown, fallback = 60) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(24 * 60, Math.trunc(n)));
}

function toMaxRetries(value: unknown, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(25, Math.trunc(n)));
}

function toBackoffBaseSeconds(value: unknown, fallback = 60) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(5, Math.min(3600, Math.trunc(n)));
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
    maxRetries: toMaxRetries(row.max_retries, 3),
    backoffBaseSeconds: toBackoffBaseSeconds(row.backoff_base_seconds, 60),
    retryCount: Math.max(0, Number(row.retry_count || 0)),
    deadLettered: Boolean(row.dead_lettered),
    deadLetteredAt: row.dead_lettered_at ? toDate(row.dead_lettered_at) : null,
    nextRunAt: row.next_run_at ? toDate(row.next_run_at) : null,
    lastRunAt: row.last_run_at ? toDate(row.last_run_at) : null,
    lastStatus: row.last_status ? String(row.last_status) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapRunRow(row: any): SchedulerRunRecord {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    trigger: String(row.trigger) === "manual" ? "manual" : "cron",
    status: String(row.status) as SchedulerStatus,
    error: row.error ? String(row.error) : null,
    durationMs: Math.max(0, Number(row.duration_ms || 0)),
    retryAttempt: Math.max(1, Number(row.retry_attempt || 1)),
    payload: parsePayload(row.payload),
    createdAt: toDate(row.created_at),
  };
}

function calculateBackoffSeconds(baseSeconds: number, retryAttempt: number) {
  const cappedAttempt = Math.max(1, Math.min(12, retryAttempt));
  const raw = baseSeconds * 2 ** (cappedAttempt - 1);
  return Math.min(24 * 60 * 60, raw);
}

export async function ensureSchedulerTables() {
  if (ensured) return;
  const table = quotedTableName();
  const runTable = quotedRunTableName();

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
        max_retries integer NOT NULL DEFAULT 3,
        backoff_base_seconds integer NOT NULL DEFAULT 60,
        retry_count integer NOT NULL DEFAULT 0,
        dead_lettered boolean NOT NULL DEFAULT false,
        dead_lettered_at timestamptz NULL,
        next_run_at timestamptz NULL DEFAULT now(),
        last_run_at timestamptz NULL,
        last_status text NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
  );

  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3`));
  await db.execute(
    sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS backoff_base_seconds integer NOT NULL DEFAULT 60`),
  );
  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`));
  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS dead_lettered boolean NOT NULL DEFAULT false`));
  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz NULL`));
  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS next_run_at timestamptz NULL DEFAULT now()`));

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS ${runTable} (
        id text PRIMARY KEY,
        schedule_id text NOT NULL,
        trigger text NOT NULL DEFAULT 'cron',
        status text NOT NULL,
        error text NULL,
        duration_ms integer NOT NULL DEFAULT 0,
        retry_attempt integer NOT NULL DEFAULT 1,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "${runTableName()}_schedule_fk"
          FOREIGN KEY (schedule_id) REFERENCES ${table}(id) ON DELETE CASCADE
      )
    `),
  );

  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "${tableName()}_due_idx" ON ${table} (enabled, dead_lettered, next_run_at)`),
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "${tableName()}_owner_idx" ON ${table} (owner_type, owner_id)`),
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "${runTableName()}_schedule_idx" ON ${runTable} (schedule_id, created_at DESC)`),
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
      (id, owner_type, owner_id, site_id, name, action_key, payload, enabled, run_every_minutes, max_retries, backoff_base_seconds, next_run_at, created_at, updated_at)
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
        ${toMaxRetries(input.maxRetries, 3)},
        ${toBackoffBaseSeconds(input.backoffBaseSeconds, 60)},
        ${input.nextRunAt ? toDate(input.nextRunAt) : new Date()},
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
  const res = await db.execute(
    sql`SELECT * FROM ${table} ${whereClause} ORDER BY dead_lettered DESC, next_run_at ASC NULLS LAST, created_at DESC`,
  );
  return ((res as any)?.rows || []).map(mapRow);
}

export async function listScheduleRunAudits(scheduleId: string, limit = 20) {
  await ensureSchedulerTables();
  const runTable = sql.raw(quotedRunTableName());
  const maxRows = Math.max(1, Math.min(100, Math.trunc(limit)));
  const res = await db.execute(
    sql`SELECT * FROM ${runTable} WHERE schedule_id = ${scheduleId} ORDER BY created_at DESC LIMIT ${maxRows}`,
  );
  return ((res as any)?.rows || []).map(mapRunRow);
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
    maxRetries: input.maxRetries === undefined ? existing.maxRetries : toMaxRetries(input.maxRetries, existing.maxRetries),
    backoffBaseSeconds:
      input.backoffBaseSeconds === undefined
        ? existing.backoffBaseSeconds
        : toBackoffBaseSeconds(input.backoffBaseSeconds, existing.backoffBaseSeconds),
    nextRunAt: input.nextRunAt === undefined ? existing.nextRunAt : input.nextRunAt ? toDate(input.nextRunAt) : null,
  };
  if (!next.name) throw new Error("Schedule name is required");
  if (!next.actionKey) throw new Error("Schedule action key is required");

  const clearDeadLetter = next.enabled && existing.deadLettered;
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
      max_retries = ${next.maxRetries},
      backoff_base_seconds = ${next.backoffBaseSeconds},
      retry_count = CASE WHEN ${clearDeadLetter} THEN 0 ELSE retry_count END,
      dead_lettered = CASE WHEN ${clearDeadLetter} THEN false ELSE dead_lettered END,
      dead_lettered_at = CASE WHEN ${clearDeadLetter} THEN NULL ELSE dead_lettered_at END,
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

async function runCoreAction(entry: ScheduleEntry): Promise<{ status: Exclude<SchedulerStatus, "dead_letter">; error?: string }> {
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

  if (action === "core.communication.retry" || action === "communication.retry") {
    const limit = Number(entry.payload?.limit || 20);
    const results = await retryPendingCommunications(Number.isFinite(limit) ? limit : 20);
    const failed = results.filter((row) => !row.ok).length;
    if (failed > 0) return { status: "error", error: `${failed} communication deliveries failed` };
    return { status: "success" };
  }

  if (action === "core.communication.purge" || action === "communication.purge") {
    const days = Number(entry.payload?.olderThanDays || 7);
    const cutoff = new Date(Date.now() - Math.max(1, Math.trunc(days || 7)) * 24 * 60 * 60 * 1000);
    await purgeCommunicationQueue({
      siteId: entry.siteId || undefined,
      before: cutoff,
    });
    return { status: "success" };
  }

  if (action === "core.webcallbacks.purge" || action === "webcallbacks.purge") {
    const days = Number(entry.payload?.olderThanDays || 7);
    const cutoff = new Date(Date.now() - Math.max(1, Math.trunc(days || 7)) * 24 * 60 * 60 * 1000);
    await purgeWebcallbackEvents({
      before: cutoff,
    });
    return { status: "success" };
  }

  if (action === "core.webhooks.retry" || action === "webhooks.retry") {
    const limit = Number(entry.payload?.limit || 25);
    const result = await retryPendingWebhookDeliveries(Number.isFinite(limit) ? limit : 25);
    if (result.failed > 0) return { status: "error", error: `${result.failed} webhook deliveries failed` };
    return { status: "success" };
  }

  if (action === "core.content.publish" || action === "content.publish") {
    const domainPostId = String(entry.payload?.domainPostId || entry.payload?.contentId || "").trim();
    if (!domainPostId) return { status: "error", error: "payload.domainPostId is required" };
    const result = await setDomainPostPublishedState({
      postId: domainPostId,
      nextPublished: true,
      actorType: "system",
    });
    if (!result.ok) {
      if (result.reason === "transition_blocked") return { status: "blocked", error: `transition blocked: ${result.from} -> ${result.to}` };
      return { status: "error", error: "domain post not found" };
    }
    return { status: "success" };
  }

  if (action === "core.content.unpublish" || action === "content.unpublish") {
    const domainPostId = String(entry.payload?.domainPostId || entry.payload?.contentId || "").trim();
    if (!domainPostId) return { status: "error", error: "payload.domainPostId is required" };
    const result = await setDomainPostPublishedState({
      postId: domainPostId,
      nextPublished: false,
      actorType: "system",
    });
    if (!result.ok) {
      if (result.reason === "transition_blocked") return { status: "blocked", error: `transition blocked: ${result.from} -> ${result.to}` };
      return { status: "error", error: "domain post not found" };
    }
    return { status: "success" };
  }

  return { status: "skipped", error: `core action not found: ${action}` };
}

function parseHandlerOutcome(output: unknown): { status: Exclude<SchedulerStatus, "dead_letter">; error?: string } | null {
  if (!output || typeof output !== "object") return null;
  const maybeStatus = String((output as any).status || "").trim();
  if (!maybeStatus) return null;
  if (maybeStatus !== "success" && maybeStatus !== "error" && maybeStatus !== "skipped" && maybeStatus !== "blocked") {
    return null;
  }
  const maybeError = String((output as any).error || "").trim();
  return { status: maybeStatus, error: maybeError || undefined };
}

async function runExtensionAction(entry: ScheduleEntry): Promise<{ status: Exclude<SchedulerStatus, "dead_letter">; error?: string }> {
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
    if (typeof handler.validate === "function") {
      const validation = await handler.validate({ siteId: entry.siteId, payload: entry.payload });
      if (!validation?.ok) {
        return { status: "blocked", error: validation?.error || "schedule precondition failed" };
      }
    }
    const output = await handler.run({ siteId: entry.siteId, payload: entry.payload });
    const parsed = parseHandlerOutcome(output);
    if (parsed) return parsed;
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function appendRunAudit(
  scheduleId: string,
  result: {
    trigger: SchedulerTrigger;
    status: SchedulerStatus;
    error?: string;
    durationMs: number;
    retryAttempt: number;
    payload: Record<string, unknown>;
  },
) {
  const runTable = sql.raw(quotedRunTableName());
  await db.execute(sql`
    INSERT INTO ${runTable}
      (id, schedule_id, trigger, status, error, duration_ms, retry_attempt, payload, created_at)
    VALUES
      (
        ${createId()},
        ${scheduleId},
        ${result.trigger},
        ${result.status},
        ${result.error || null},
        ${Math.max(0, Math.trunc(result.durationMs))},
        ${Math.max(1, Math.trunc(result.retryAttempt))},
        ${JSON.stringify(result.payload || {})}::jsonb,
        now()
      )
  `);
}

async function executeScheduleEntry(entry: ScheduleEntry, trigger: SchedulerTrigger) {
  const startedAt = Date.now();
  const pendingAttempt = entry.retryCount + 1;
  const execution =
    entry.ownerType === "core" ? await runCoreAction(entry) : await runExtensionAction(entry);
  const durationMs = Date.now() - startedAt;
  const now = new Date();

  let finalStatus: SchedulerStatus = execution.status;
  let nextRetryCount = entry.retryCount;
  let nextRunAt: Date | null = new Date(now.getTime() + entry.runEveryMinutes * 60 * 1000);
  let deadLettered = false;
  let deadLetteredAt: Date | null = null;

  if (execution.status === "error") {
    nextRetryCount = entry.retryCount + 1;
    if (nextRetryCount > entry.maxRetries) {
      finalStatus = "dead_letter";
      deadLettered = true;
      deadLetteredAt = now;
      nextRunAt = null;
    } else {
      const backoffSeconds = calculateBackoffSeconds(entry.backoffBaseSeconds, nextRetryCount);
      nextRunAt = new Date(now.getTime() + backoffSeconds * 1000);
    }
  } else {
    nextRetryCount = 0;
  }

  const table = sql.raw(quotedTableName());
  await db.execute(sql`
    UPDATE ${table}
    SET
      last_run_at = now(),
      last_status = ${finalStatus},
      last_error = ${execution.error || ""},
      retry_count = ${nextRetryCount},
      dead_lettered = ${deadLettered},
      dead_lettered_at = ${deadLetteredAt},
      next_run_at = ${nextRunAt},
      updated_at = now()
    WHERE id = ${entry.id}
  `);

  await appendRunAudit(entry.id, {
    trigger,
    status: finalStatus,
    error: execution.error,
    durationMs,
    retryAttempt: pendingAttempt,
    payload: entry.payload,
  });

  return {
    status: finalStatus,
    error: execution.error || "",
    durationMs,
  };
}

export async function runDueSchedules(limit = 25) {
  await ensureSchedulerTables();
  const enabled = await getBooleanSetting(SCHEDULES_ENABLED_KEY, false);
  if (!enabled) {
    return { ran: 0, skipped: 0, blocked: 0, errors: 0, deadLettered: 0, message: "schedules disabled" };
  }

  const table = sql.raw(quotedTableName());
  const now = new Date();
  const dueRes = await db.execute(sql`
    SELECT * FROM ${table}
    WHERE enabled = true
      AND dead_lettered = false
      AND next_run_at IS NOT NULL
      AND next_run_at <= ${now}
    ORDER BY next_run_at ASC
    LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}
  `);
  const due = ((dueRes as any)?.rows || []).map(mapRow);

  let ran = 0;
  let skipped = 0;
  let blocked = 0;
  let errors = 0;
  let deadLettered = 0;

  for (const entry of due) {
    const result = await executeScheduleEntry(entry, "cron");
    ran += 1;
    if (result.status === "skipped") skipped += 1;
    if (result.status === "blocked") blocked += 1;
    if (result.status === "error") errors += 1;
    if (result.status === "dead_letter") deadLettered += 1;
  }

  trace("scheduler", "due schedules processed", { due: due.length, ran, skipped, blocked, errors, deadLettered });
  return { ran, skipped, blocked, errors, deadLettered, message: "ok" };
}

export async function runScheduleEntryNow(id: string) {
  await ensureSchedulerTables();
  const entry = await getScheduleEntryById(id);
  if (!entry) throw new Error("Schedule not found");

  const result = await executeScheduleEntry(entry, "manual");

  trace("scheduler", "schedule entry run now", {
    id: entry.id,
    ownerType: entry.ownerType,
    ownerId: entry.ownerId,
    actionKey: entry.actionKey,
    status: result.status,
    error: result.error,
    durationMs: result.durationMs,
  });

  return {
    ok: result.status !== "error" && result.status !== "dead_letter",
    id: entry.id,
    status: result.status,
    error: result.error,
  };
}
