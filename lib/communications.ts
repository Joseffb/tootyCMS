import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import db from "@/lib/db";
import { communicationAttempts, communicationMessages, sites, users } from "@/lib/schema";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import type { CommunicationChannel, CommunicationMessagePayload } from "@/lib/kernel";
import { trace } from "@/lib/debug";
import { getSiteCommunicationGovernance } from "@/lib/cms-config";
import { emitDomainEvent } from "@/lib/domain-dispatch";
import type { DomainEventName } from "@/lib/domain-events";
import type { CommunicationListItem } from "@/lib/communications-types";

export type CommunicationStatus = "queued" | "retrying" | "sent" | "failed" | "dead" | "logged";
export type CommunicationCategory = "transactional" | "marketing";

export type SendCommunicationInput = {
  siteId?: string | null;
  channel: CommunicationChannel;
  to: string;
  subject?: string | null;
  body: string;
  category?: CommunicationCategory;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
};

export type SendCommunicationOptions = {
  createdByUserId?: string;
};

type DeliveryAttempt = {
  providerId: string;
  eventId?: string;
  ok: boolean;
  externalId?: string;
  error?: string;
  response?: Record<string, unknown>;
};

function normalizePreferredProvider(metadata: Record<string, unknown>) {
  const raw = String(metadata.preferredProvider || "").trim();
  return raw;
}

export type SendCommunicationResult = {
  ok: boolean;
  messageId: string;
  status: CommunicationStatus;
  providerId: string;
  error?: string;
};

export class CommunicationGovernanceError extends Error {
  readonly code: "disabled" | "rate_limited";
  readonly status: 403 | 429;
  readonly details?: Record<string, unknown>;

  constructor(
    code: "disabled" | "rate_limited",
    message: string,
    status: 403 | 429,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeChannel(input: unknown): CommunicationChannel {
  const value = String(input || "").trim().toLowerCase();
  if (value === "email" || value === "sms" || value === "mms" || value === "com-x") return value;
  throw new Error(`Unsupported communication channel: ${value || "(empty)"}`);
}

export function normalizeTo(input: unknown) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Communication recipient is required.");
  return value;
}

export function normalizeBody(input: unknown) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Communication body is required.");
  return value;
}

function normalizeMetadata(input: unknown) {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function statusEventName(status: CommunicationStatus): DomainEventName | null {
  if (status === "queued") return "communication.queued";
  if (status === "sent" || status === "logged") return "communication.sent";
  if (status === "failed" || status === "retrying") return "communication.failed";
  if (status === "dead") return "communication.dead";
  return null;
}

async function emitCommunicationLifecycleEvent(input: {
  messageId: string;
  siteId?: string | null;
  status: CommunicationStatus;
  previousStatus?: CommunicationStatus;
  channel?: string;
  category?: string;
  providerId?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const name = statusEventName(input.status);
  if (!name) return;
  await emitDomainEvent({
    version: 1,
    name,
    timestamp: new Date().toISOString(),
    siteId: input.siteId || undefined,
    actorType: "system",
    payload: {
      messageId: input.messageId,
      status: input.status,
      ...(input.previousStatus ? { previousStatus: input.previousStatus } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(typeof input.attemptCount === "number" ? { attemptCount: input.attemptCount } : {}),
      ...(typeof input.maxAttempts === "number" ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  });
}

async function updateMessageWithTransition(input: {
  messageId: string;
  nextStatus: CommunicationStatus;
  providerId?: string | null;
  externalId?: string | null;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const before = await db.query.communicationMessages.findFirst({
    where: eq(communicationMessages.id, input.messageId),
    columns: {
      id: true,
      siteId: true,
      status: true,
      channel: true,
      category: true,
      maxAttempts: true,
    },
  });
  if (!before) return { ok: false as const };

  await db
    .update(communicationMessages)
    .set({
      status: input.nextStatus,
      ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      ...(input.attemptCount !== undefined ? { attemptCount: input.attemptCount } : {}),
      ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      updatedAt: new Date(),
    })
    .where(eq(communicationMessages.id, input.messageId));

  if (before.status !== input.nextStatus) {
    await emitCommunicationLifecycleEvent({
      messageId: before.id,
      siteId: before.siteId,
      status: input.nextStatus,
      previousStatus: before.status as CommunicationStatus,
      channel: before.channel,
      category: before.category,
      providerId: input.providerId,
      attemptCount: input.attemptCount,
      maxAttempts: before.maxAttempts,
      error: input.lastError,
      metadata: input.metadata,
    });
  }

  return { ok: true as const };
}

async function enforceCommunicationGovernance(siteId?: string | null) {
  const governance = await getSiteCommunicationGovernance(siteId || null);
  if (!governance.enabled) {
    throw new CommunicationGovernanceError(
      "disabled",
      "Communication is disabled for this site.",
      403,
      { siteId: siteId || null },
    );
  }
  if (!siteId) return;

  const windowStart = new Date(Date.now() - governance.rateLimitWindowSeconds * 1000);
  const rows = await db
    .select({ total: count() })
    .from(communicationMessages)
    .where(and(eq(communicationMessages.siteId, siteId), gte(communicationMessages.createdAt, windowStart)));

  const current = Number(rows[0]?.total ?? 0);
  if (current >= governance.rateLimitMax) {
    throw new CommunicationGovernanceError(
      "rate_limited",
      "Communication rate limit exceeded for this site.",
      429,
      {
        siteId,
        current,
        limit: governance.rateLimitMax,
        windowSeconds: governance.rateLimitWindowSeconds,
      },
    );
  }
}

function toMessagePayload(row: {
  id: string;
  siteId: string | null;
  channel: string;
  to: string;
  subject: string | null;
  body: string;
  category: string;
  metadata: unknown;
}): CommunicationMessagePayload {
  return {
    id: row.id,
    siteId: row.siteId,
    channel: normalizeChannel(row.channel),
    to: row.to,
    subject: row.subject,
    body: row.body,
    category: row.category === "marketing" ? "marketing" : "transactional",
    metadata: normalizeMetadata(row.metadata),
  };
}

async function writeAttempt(messageId: string, attempt: DeliveryAttempt) {
  await db.insert(communicationAttempts).values({
    messageId,
    providerId: attempt.providerId,
    eventId: attempt.eventId || null,
    status: attempt.ok ? "sent" : "failed",
    error: attempt.error || null,
    response: attempt.response || {},
  });
}

async function applyNullProvider(messageId: string) {
  const providerId = "native:null-provider";
  await writeAttempt(messageId, {
    providerId,
    ok: true,
    response: { mode: "log-only" },
  });
  await updateMessageWithTransition({
    messageId,
    nextStatus: "logged",
    providerId,
    attemptCount: 1,
    nextAttemptAt: null,
    lastError: null,
    metadata: { mode: "log-only" },
  });
  trace("communications", "message handled by null provider", { messageId, providerId });
  return {
    ok: true,
    messageId,
    status: "logged" as const,
    providerId,
  };
}

async function deliverMessage(messageId: string): Promise<SendCommunicationResult> {
  const row = await db.query.communicationMessages.findFirst({
    where: eq(communicationMessages.id, messageId),
    columns: {
      id: true,
      siteId: true,
      channel: true,
      to: true,
      subject: true,
      body: true,
      category: true,
      metadata: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });
  if (!row) {
    throw new Error("Communication message not found.");
  }

  const kernel = await createKernelForRequest(row.siteId || undefined);
  const providers = kernel
    .getAllPluginCommunicationProviders()
    .filter((provider) => provider.channels.includes(normalizeChannel(row.channel)));
  const metadata = normalizeMetadata(row.metadata);
  const preferredProvider = normalizePreferredProvider(metadata);
  const orderedProviders = preferredProvider
    ? [...providers].sort((a, b) => {
        const aFull = `${a.pluginId}:${a.id}`;
        const bFull = `${b.pluginId}:${b.id}`;
        const aMatch = a.id === preferredProvider || aFull === preferredProvider;
        const bMatch = b.id === preferredProvider || bFull === preferredProvider;
        if (aMatch === bMatch) return 0;
        return aMatch ? -1 : 1;
      })
    : providers;

  if (orderedProviders.length === 0) {
    return applyNullProvider(messageId);
  }

  const payload = toMessagePayload(row);
  let lastError = "Communication delivery failed.";
  let attemptCount = row.attemptCount ?? 0;

  for (const provider of orderedProviders) {
    const providerRef = `${provider.pluginId}:${provider.id}`;
    try {
      const result = await provider.deliver(payload);
      attemptCount += 1;
      await writeAttempt(messageId, {
        providerId: providerRef,
        ok: Boolean(result?.ok),
        externalId: result?.externalId,
        error: result?.error,
        response: result?.response,
      });
      if (result?.ok) {
        await updateMessageWithTransition({
          messageId,
          nextStatus: "sent",
          providerId: providerRef,
          externalId: result.externalId || null,
          attemptCount,
          nextAttemptAt: null,
          lastError: null,
          metadata: {
            externalId: result.externalId || null,
          },
        });
        return {
          ok: true,
          messageId,
          status: "sent",
          providerId: providerRef,
        };
      }
      lastError = result?.error || lastError;
    } catch (error) {
      attemptCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      await writeAttempt(messageId, {
        providerId: providerRef,
        ok: false,
        error: message,
      });
    }
  }

  const maxAttempts = Math.max(1, row.maxAttempts || 3);
  const terminal = attemptCount >= maxAttempts;
  const backoffMs = Math.min(5 * 60_000, 15_000 * Math.max(1, attemptCount));
  const nextAttemptAt = terminal ? null : new Date(Date.now() + backoffMs);
  const status: CommunicationStatus = terminal ? "dead" : "retrying";
  await updateMessageWithTransition({
    messageId,
    nextStatus: status,
    attemptCount,
    nextAttemptAt,
    lastError: lastError || null,
  });

  return {
    ok: false,
    messageId,
    status,
    providerId: "none",
    error: lastError,
  };
}

export async function sendCommunication(
  input: SendCommunicationInput,
  options?: SendCommunicationOptions,
): Promise<SendCommunicationResult> {
  await enforceCommunicationGovernance(input.siteId || null);
  const messageId = createId();
  const channel = normalizeChannel(input.channel);
  const to = normalizeTo(input.to);
  const body = normalizeBody(input.body);
  const subject = input.subject?.trim() || null;
  const category = input.category === "marketing" ? "marketing" : "transactional";
  const maxAttempts = Math.max(1, Number(input.maxAttempts || 3));
  await db.insert(communicationMessages).values({
    id: messageId,
    siteId: input.siteId || null,
    channel,
    to,
    subject,
    body,
    category,
    status: "queued",
    metadata: normalizeMetadata(input.metadata),
    createdByUserId: options?.createdByUserId || null,
    maxAttempts,
    attemptCount: 0,
  });
  await emitCommunicationLifecycleEvent({
    messageId,
    siteId: input.siteId || null,
    status: "queued",
    channel,
    category,
    attemptCount: 0,
    maxAttempts,
    metadata: normalizeMetadata(input.metadata),
  });
  await (async () => {
    const kernel = await createKernelForRequest(input.siteId || undefined);
    await kernel.doAction("communication:queued", {
      messageId,
      siteId: input.siteId || null,
      channel,
      to,
      category,
    });
  })().catch((error) => {
    trace("communications", "communication:queued action failed", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return deliverMessage(messageId);
}

export async function retryPendingCommunications(limit = 20) {
  const now = new Date();
  const due = await db.query.communicationMessages.findMany({
    where: and(
      inArray(communicationMessages.status, ["queued", "retrying", "failed"] as CommunicationStatus[]),
      or(isNull(communicationMessages.nextAttemptAt), lte(communicationMessages.nextAttemptAt, now)),
    ),
    columns: { id: true },
    orderBy: [asc(communicationMessages.createdAt)],
    limit: Math.max(1, limit),
  });

  const results: SendCommunicationResult[] = [];
  for (const row of due) {
    results.push(await deliverMessage(row.id));
  }
  return results;
}

export async function purgeCommunicationQueue(input?: {
  siteId?: string;
  statuses?: CommunicationStatus[];
  before?: Date;
}) {
  const statuses = input?.statuses?.length
    ? input.statuses
    : (["queued", "retrying", "failed", "dead", "logged"] as CommunicationStatus[]);

  const conditions = [inArray(communicationMessages.status, statuses)];
  if (input?.siteId) conditions.push(eq(communicationMessages.siteId, input.siteId));
  if (input?.before) conditions.push(lte(communicationMessages.createdAt, input.before));

  const deleted = await db
    .delete(communicationMessages)
    .where(and(...conditions))
    .returning({ id: communicationMessages.id });
  return { count: deleted.length, ids: deleted.map((row) => row.id) };
}

export async function applyCommunicationCallback(input: {
  providerId: string;
  messageId?: string;
  externalId?: string;
  eventId?: string;
  status?: "sent" | "failed" | "dead" | "logged";
  error?: string;
  metadata?: Record<string, unknown>;
  eventType?: string;
}) {
  const status = input.status || "sent";
  const row = input.messageId
    ? await db.query.communicationMessages.findFirst({
        where: eq(communicationMessages.id, input.messageId),
        columns: { id: true },
      })
    : await db.query.communicationMessages.findFirst({
        where: and(
          eq(communicationMessages.providerId, input.providerId),
          eq(communicationMessages.externalId, String(input.externalId || "")),
        ),
        columns: { id: true },
      });
  if (!row) return { ok: false, reason: "message_not_found" as const };
  const callbackEventId = String(input.eventId || "").trim();
  if (callbackEventId) {
    const existing = await db.query.communicationAttempts.findFirst({
      where: and(eq(communicationAttempts.providerId, input.providerId), eq(communicationAttempts.eventId, callbackEventId)),
      columns: { id: true },
    });
    if (existing) return { ok: true, messageId: row.id, duplicate: true as const };
  }

  await updateMessageWithTransition({
    messageId: row.id,
    nextStatus: status,
    lastError: input.error || null,
    metadata: {
      eventType: input.eventType || "callback",
      ...(input.metadata || {}),
    },
  });
  await db.insert(communicationAttempts).values({
    messageId: row.id,
    providerId: input.providerId,
    eventId: callbackEventId || null,
    status,
    error: input.error || null,
    response: {
      eventType: input.eventType || "callback",
      ...(input.metadata || {}),
    },
  });
  return { ok: true, messageId: row.id };
}

export async function listCommunicationMessages(input?: {
  siteId?: string;
  includeGlobal?: boolean;
  search?: string;
  status?: string;
  providerId?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input?.limit || 20))));
  const offset = Math.max(0, Math.trunc(Number(input?.offset || 0)));
  const search = String(input?.search || "").trim();
  const status = String(input?.status || "").trim();
  const providerId = String(input?.providerId || "").trim();
  const siteId = String(input?.siteId || "").trim();
  const includeGlobal = Boolean(input?.includeGlobal);

  const where = [];
  if (siteId) {
    where.push(
      includeGlobal
        ? or(eq(communicationMessages.siteId, siteId), isNull(communicationMessages.siteId))
        : eq(communicationMessages.siteId, siteId),
    );
  }
  if (status) where.push(eq(communicationMessages.status, status));
  if (providerId) where.push(eq(communicationMessages.providerId, providerId));
  if (search) {
    where.push(
      or(
        ilike(communicationMessages.id, `%${search}%`),
        ilike(communicationMessages.to, `%${search}%`),
        ilike(communicationMessages.subject, `%${search}%`),
        ilike(communicationMessages.externalId, `%${search}%`),
      ),
    );
  }

  const rows = await db
    .select({
      id: communicationMessages.id,
      siteId: communicationMessages.siteId,
      siteName: sites.name,
      createdByUserId: communicationMessages.createdByUserId,
      createdByEmail: users.email,
      channel: communicationMessages.channel,
      to: communicationMessages.to,
      subject: communicationMessages.subject,
      body: communicationMessages.body,
      metadata: communicationMessages.metadata,
      status: communicationMessages.status,
      providerId: communicationMessages.providerId,
      externalId: communicationMessages.externalId,
      attemptCount: communicationMessages.attemptCount,
      maxAttempts: communicationMessages.maxAttempts,
      lastError: communicationMessages.lastError,
      createdAt: communicationMessages.createdAt,
      updatedAt: communicationMessages.updatedAt,
    })
    .from(communicationMessages)
    .leftJoin(sites, eq(sites.id, communicationMessages.siteId))
    .leftJoin(users, eq(users.id, communicationMessages.createdByUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(communicationMessages.createdAt), desc(communicationMessages.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit) as CommunicationListItem[];
  return {
    items,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

export async function adminSetCommunicationStatus(input: {
  messageId: string;
  status: CommunicationStatus;
  error?: string | null;
}) {
  const messageId = String(input.messageId || "").trim();
  if (!messageId) throw new Error("messageId is required.");
  await updateMessageWithTransition({
    messageId,
    nextStatus: input.status,
    nextAttemptAt: null,
    ...(input.error !== undefined ? { lastError: input.error } : {}),
  });
  return { ok: true as const, messageId, status: input.status };
}

export async function adminRetryCommunicationMessage(messageId: string) {
  const id = String(messageId || "").trim();
  if (!id) throw new Error("messageId is required.");
  await updateMessageWithTransition({
    messageId: id,
    nextStatus: "queued",
    nextAttemptAt: null,
    lastError: null,
  });
  return deliverMessage(id);
}
