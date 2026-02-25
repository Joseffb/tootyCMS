import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import db from "@/lib/db";
import { trace } from "@/lib/debug";
import type { DomainEvent } from "@/lib/domain-events";
import { webhookDeliveries, webhookSubscriptions } from "@/lib/schema";
import { signCanonicalPayload } from "@/lib/signing";

export type WebhookDeliveryStatus = "queued" | "retrying" | "sent" | "failed" | "dead";

export async function listWebhookSubscriptions(siteId?: string | null) {
  const normalized = String(siteId || "").trim();
  return db.query.webhookSubscriptions.findMany({
    where: normalized ? eq(webhookSubscriptions.siteId, normalized) : isNull(webhookSubscriptions.siteId),
    orderBy: [asc(webhookSubscriptions.eventName), asc(webhookSubscriptions.endpointUrl)],
  });
}

export async function upsertWebhookSubscription(input: {
  siteId?: string | null;
  eventName: string;
  endpointUrl: string;
  secret?: string | null;
  enabled?: boolean;
  maxRetries?: number;
  backoffBaseSeconds?: number;
  headers?: Record<string, string>;
}) {
  const siteId = String(input.siteId || "").trim() || null;
  const eventName = String(input.eventName || "").trim();
  const endpointUrl = String(input.endpointUrl || "").trim();
  if (!eventName) throw new Error("Webhook subscription eventName is required.");
  if (!endpointUrl) throw new Error("Webhook subscription endpointUrl is required.");

  await db
    .insert(webhookSubscriptions)
    .values({
      siteId,
      eventName,
      endpointUrl,
      secret: String(input.secret || "").trim() || null,
      enabled: input.enabled !== false,
      maxRetries: Math.max(1, Math.trunc(Number(input.maxRetries || 4))),
      backoffBaseSeconds: Math.max(5, Math.trunc(Number(input.backoffBaseSeconds || 30))),
      headers: input.headers || {},
    })
    .onConflictDoUpdate({
      target: [webhookSubscriptions.siteId, webhookSubscriptions.eventName, webhookSubscriptions.endpointUrl],
      set: {
        secret: String(input.secret || "").trim() || null,
        enabled: input.enabled !== false,
        maxRetries: Math.max(1, Math.trunc(Number(input.maxRetries || 4))),
        backoffBaseSeconds: Math.max(5, Math.trunc(Number(input.backoffBaseSeconds || 30))),
        headers: input.headers || {},
        updatedAt: new Date(),
      },
    });
}

export async function deleteWebhookSubscription(id: number) {
  await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
}

export function toWebhookPayload(event: DomainEvent) {
  return {
    event_id: String(event.id || "").trim(),
    timestamp: event.timestamp,
    site_id: event.siteId || null,
    event_name: event.name,
    version: event.version,
    domain: event.domain || null,
    path: event.path || null,
    actor_type: event.actorType || null,
    actor_id: event.actorId || null,
    payload: event.payload || {},
    meta: event.meta || {},
  };
}

function calculateBackoffSeconds(baseSeconds: number, attempt: number) {
  const base = Math.max(5, Math.trunc(baseSeconds || 30));
  const count = Math.max(1, Math.min(10, Math.trunc(attempt || 1)));
  return Math.min(600, base * 2 ** (count - 1));
}

async function enqueueDeliveriesForEvent(event: DomainEvent) {
  const eventId = String(event.id || "").trim();
  if (!eventId) return 0;
  const siteId = String(event.siteId || "").trim();
  const subscriptions = await db.query.webhookSubscriptions.findMany({
    where: and(
      eq(webhookSubscriptions.enabled, true),
      eq(webhookSubscriptions.eventName, event.name),
      siteId ? eq(webhookSubscriptions.siteId, siteId) : isNull(webhookSubscriptions.siteId),
    ),
    columns: {
      id: true,
      siteId: true,
      endpointUrl: true,
      secret: true,
      maxRetries: true,
      headers: true,
    },
  });
  if (subscriptions.length === 0) return 0;

  const basePayload = toWebhookPayload(event);
  let inserted = 0;
  for (const sub of subscriptions) {
    const payload = { ...basePayload };
    const canonicalWithoutSignature = JSON.stringify(payload);
    const signed = signCanonicalPayload({
      canonicalPayloadJson: canonicalWithoutSignature,
      secret: sub.secret,
    });
    const finalPayload = {
      ...payload,
      signature: signed.signature,
    };
    const headers = {
      "content-type": "application/json",
      "x-tooty-event-id": payload.event_id,
      "x-tooty-event-name": payload.event_name,
      "x-tooty-site-id": payload.site_id || "",
      "x-tooty-timestamp": signed.timestamp,
      "x-tooty-signature": signed.signature,
      "x-tooty-payload-sha256": signed.payloadHash,
      ...(sub.headers && typeof sub.headers === "object" ? (sub.headers as Record<string, string>) : {}),
    };
    const result = await db
      .insert(webhookDeliveries)
      .values({
        id: createId(),
        subscriptionId: sub.id,
        siteId: sub.siteId || null,
        eventId: payload.event_id,
        eventName: payload.event_name,
        endpointUrl: sub.endpointUrl,
        status: "queued",
        attemptCount: 0,
        maxAttempts: Math.max(1, Number(sub.maxRetries || 4)),
        requestBody: JSON.stringify(finalPayload),
        requestHeaders: headers,
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing({
        target: [webhookDeliveries.subscriptionId, webhookDeliveries.eventId],
      })
      .returning({ id: webhookDeliveries.id });
    if ((result?.length || 0) > 0) inserted += 1;
  }
  return inserted;
}

async function deliverWebhook(id: string) {
  const row = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, id),
    columns: {
      id: true,
      endpointUrl: true,
      requestBody: true,
      requestHeaders: true,
      attemptCount: true,
      maxAttempts: true,
      status: true,
    },
  });
  if (!row) return { ok: false as const, status: "dead" as WebhookDeliveryStatus, error: "delivery_not_found" };

  const headers = row.requestHeaders && typeof row.requestHeaders === "object"
    ? (row.requestHeaders as Record<string, string>)
    : {};
  const nextAttemptCount = Math.max(0, Number(row.attemptCount || 0)) + 1;
  try {
    const res = await fetch(row.endpointUrl, {
      method: "POST",
      headers,
      body: row.requestBody,
      cache: "no-store",
    });
    const body = await res.text().catch(() => "");
    if (res.ok) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "sent",
          attemptCount: nextAttemptCount,
          responseStatus: res.status,
          responseBody: body.slice(0, 2000),
          nextAttemptAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, row.id));
      return { ok: true as const, status: "sent" as WebhookDeliveryStatus };
    }

    const terminal = nextAttemptCount >= Math.max(1, Number(row.maxAttempts || 4));
    const status: WebhookDeliveryStatus = terminal ? "dead" : "retrying";
    const backoff = calculateBackoffSeconds(30, nextAttemptCount);
    await db
      .update(webhookDeliveries)
      .set({
        status,
        attemptCount: nextAttemptCount,
        responseStatus: res.status,
        responseBody: body.slice(0, 2000),
        nextAttemptAt: terminal ? null : new Date(Date.now() + backoff * 1000),
        lastError: `http_${res.status}`,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, row.id));
    return { ok: false as const, status, error: `http_${res.status}` };
  } catch (error) {
    const terminal = nextAttemptCount >= Math.max(1, Number(row.maxAttempts || 4));
    const status: WebhookDeliveryStatus = terminal ? "dead" : "retrying";
    const backoff = calculateBackoffSeconds(30, nextAttemptCount);
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(webhookDeliveries)
      .set({
        status,
        attemptCount: nextAttemptCount,
        responseStatus: null,
        responseBody: null,
        nextAttemptAt: terminal ? null : new Date(Date.now() + backoff * 1000),
        lastError: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, row.id));
    return { ok: false as const, status, error: message };
  }
}

export async function fanoutDomainEventToWebhooks(event: DomainEvent) {
  const inserted = await enqueueDeliveriesForEvent(event);
  if (inserted <= 0) return { inserted: 0, delivered: 0 };
  const delivered = await retryPendingWebhookDeliveries(Math.max(1, inserted));
  return { inserted, delivered: delivered.processed };
}

export async function retryPendingWebhookDeliveries(limit = 25) {
  const due = await db.query.webhookDeliveries.findMany({
    where: and(
      inArray(webhookDeliveries.status, ["queued", "retrying", "failed"] as WebhookDeliveryStatus[]),
      or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, new Date())),
    ),
    columns: { id: true },
    orderBy: [asc(webhookDeliveries.createdAt)],
    limit: Math.max(1, Math.min(200, limit)),
  });

  let processed = 0;
  let failed = 0;
  let dead = 0;
  for (const row of due) {
    const res = await deliverWebhook(row.id);
    processed += 1;
    if (!res.ok) failed += 1;
    if (res.status === "dead") dead += 1;
  }
  if (processed > 0) {
    trace("webhooks", "retry batch processed", { processed, failed, dead });
  }
  return { processed, failed, dead };
}
