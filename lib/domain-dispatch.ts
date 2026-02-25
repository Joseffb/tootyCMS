import { createKernelForRequest } from "@/lib/plugin-runtime";
import type { DomainEvent } from "@/lib/domain-events";
import {
  claimDomainEventBatch,
  enqueueDomainEvent,
  markDomainEventFailed,
  markDomainEventProcessed,
} from "@/lib/domain-queue";
import { createId } from "@paralleldrive/cuid2";
import { fanoutDomainEventToWebhooks } from "@/lib/webhook-delivery";
import { trace } from "@/lib/debug";

let draining = false;

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

export async function processDomainQueueBatch(limit = 25) {
  if (draining) return { processed: 0 };
  draining = true;
  try {
    const rows = await claimDomainEventBatch(limit);
    let processed = 0;
    for (const row of rows) {
      try {
        await dispatchDomainEventImmediate(row.event);
        await markDomainEventProcessed(row.id);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markDomainEventFailed(row.id, row.attempts, message);
      }
    }
    return { processed };
  } finally {
    draining = false;
  }
}

export async function emitDomainEvent(event: DomainEvent) {
  const withId: DomainEvent = {
    ...event,
    id: event.id || createId(),
  };
  await enqueueDomainEvent(withId);
  if (process.env.DOMAIN_EVENT_QUEUE_AUTODRAIN === "false") return;
  await processDomainQueueBatch(25);
}
