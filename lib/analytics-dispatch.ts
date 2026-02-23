import { createKernelForRequest } from "@/lib/plugin-runtime";
import type { AnalyticsEvent } from "@/lib/analytics-events";
import {
  claimAnalyticsEventBatch,
  enqueueAnalyticsEvent,
  markAnalyticsEventFailed,
  markAnalyticsEventProcessed,
} from "@/lib/analytics-queue";

let draining = false;

export async function dispatchAnalyticsEventImmediate(event: AnalyticsEvent) {
  const kernel = await createKernelForRequest(event.siteId);
  await kernel.doAction("analytics:event", event);
}

export async function processAnalyticsQueueBatch(limit = 25) {
  if (draining) return { processed: 0 };
  draining = true;
  try {
    const rows = await claimAnalyticsEventBatch(limit);
    let processed = 0;
    for (const row of rows) {
      try {
        await dispatchAnalyticsEventImmediate(row.event);
        await markAnalyticsEventProcessed(row.id);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markAnalyticsEventFailed(row.id, row.attempts, message);
      }
    }
    return { processed };
  } finally {
    draining = false;
  }
}

export async function emitAnalyticsEvent(event: AnalyticsEvent) {
  await enqueueAnalyticsEvent(event);
  if (process.env.ANALYTICS_QUEUE_AUTODRAIN === "false") return;
  await processAnalyticsQueueBatch(25);
}

