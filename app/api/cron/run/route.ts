import { NextResponse } from "next/server";
import {
  acquireSchedulerLock,
  releaseSchedulerLock,
  runDueNetworkSchedules,
  runDueSiteSchedulesForAllEnabledSites,
} from "@/lib/scheduler";
import { processAllSiteDomainQueues } from "@/lib/domain-dispatch";
import { trace } from "@/lib/debug";

function isAuthorized(req: Request) {
  const configured = String(process.env.CRON_RUN_TOKEN || process.env.AUTH_BEARER_TOKEN || "").trim();
  if (!configured) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return token.length > 0 && token === configured;
}

export async function POST(req: Request) {
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
  if (!isAuthorized(req)) {
    trace("scheduler", "cron run unauthorized", { traceId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gotLock = await acquireSchedulerLock();
  if (!gotLock) {
    trace("scheduler", "cron run skipped: lock busy", { traceId });
    return NextResponse.json({ ok: true, busy: true, message: "runner lock busy" }, { status: 202 });
  }

  try {
    const networkSchedules = await runDueNetworkSchedules(50);
    const siteSchedules = await runDueSiteSchedulesForAllEnabledSites(25);
    const domainQueue = await processAllSiteDomainQueues(25);
    const result = {
      networkSchedules,
      siteSchedules,
      ran: networkSchedules.ran + siteSchedules.ran,
      skipped: networkSchedules.skipped + siteSchedules.skipped,
      blocked: networkSchedules.blocked + siteSchedules.blocked,
      errors: networkSchedules.errors + siteSchedules.errors,
      deadLettered: networkSchedules.deadLettered + siteSchedules.deadLettered,
      domainQueueProcessed: domainQueue.processed,
      domainQueueSitesChecked: domainQueue.sitesChecked,
    };
    trace("scheduler", "cron run completed", { traceId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace("scheduler", "cron run failed", { traceId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseSchedulerLock();
  }
}

export async function GET(req: Request) {
  return POST(req);
}
