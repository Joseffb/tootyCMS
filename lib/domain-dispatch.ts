import { createKernelForRequest } from "@/lib/plugin-runtime";
import type { DomainEvent } from "@/lib/domain-events";
import {
  claimDomainEventBatch,
  enqueueDomainEvent,
  listKnownDomainQueueSiteIds,
  markDomainEventFailed,
  markDomainEventProcessed,
} from "@/lib/domain-queue";
import { createId } from "@paralleldrive/cuid2";
import { fanoutDomainEventToWebhooks } from "@/lib/webhook-delivery";
import { trace } from "@/lib/debug";

const drainingSites = new Set<string>();

export async function dispatchDomainEventImmediate(event: DomainEvent) {
  const kernel = await createKernelForRequest(event.siteId);
  await kernel.doAction("domain:event", event);
  await fanoutDomainEventToWebhooks(event).catch((error) => {
    trace("domain-events", "webhook fanout failed", {
      eventName: event.name,
      eventId: event.id || null,
      siteId: event.siteId || null,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function processDomainQueueBatch(siteId: string, limit = 25) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return { processed: 0 };
  if (drainingSites.has(normalizedSiteId)) return { processed: 0 };
  drainingSites.add(normalizedSiteId);
  try {
    const rows = await claimDomainEventBatch(normalizedSiteId, limit);
    let processed = 0;
    for (const row of rows) {
      try {
        await dispatchDomainEventImmediate(row.event);
        await markDomainEventProcessed(row.siteId, row.id);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markDomainEventFailed(row.siteId, row.id, row.attempts, message);
      }
    }
    return { processed };
  } finally {
    drainingSites.delete(normalizedSiteId);
  }
}

export async function emitDomainEvent(event: DomainEvent) {
  const withId: DomainEvent = {
    ...event,
    id: event.id || createId(),
  };
  const siteId = String(withId.siteId || "").trim();
  if (!siteId) {
    await dispatchDomainEventImmediate(withId);
    return;
  }

  await enqueueDomainEvent({
    ...withId,
    siteId,
  });
  if (process.env.DOMAIN_EVENT_QUEUE_AUTODRAIN === "false") return;
  await processDomainQueueBatch(siteId, 25);
}

export async function processAllSiteDomainQueues(limitPerSite = 25) {
  const siteIds = await listKnownDomainQueueSiteIds().catch(() => []);
  let processed = 0;
  for (const siteId of siteIds) {
    const result = await processDomainQueueBatch(siteId, limitPerSite);
    processed += result.processed;
  }
  return {
    processed,
    sitesChecked: siteIds.length,
  };
}
