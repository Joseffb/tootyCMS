import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_CONSENT_COOKIE,
  LEGACY_ANALYTICS_CONSENT_COOKIE,
  isGpcEnabled,
  parseAnalyticsConsent,
  shouldCollectAnalytics,
} from "@/lib/privacy-consent";
import { resolveAnalyticsSiteId } from "@/lib/analytics-site";
import { normalizeAnalyticsEvent } from "@/lib/analytics-events";
import { emitAnalyticsEvent } from "@/lib/analytics-dispatch";
import { isLocalHostLike } from "@/lib/site-url";

export const runtime = "nodejs";

function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function isLocalRequest(req: NextRequest) {
  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) || firstHeaderValue(req.headers.get("host"));
  return isLocalHostLike(host);
}

export async function POST(req: NextRequest) {
  const localRequest = isLocalRequest(req);
  const gpcEnabled = isGpcEnabled(req.headers.get("sec-gpc"));
  const consent = parseAnalyticsConsent(
    req.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value ??
      req.cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE)?.value,
  );
  if (!localRequest && !shouldCollectAnalytics({ consent, gpcEnabled })) {
    return new NextResponse("Analytics disabled by privacy preference", { status: 202 });
  }

  const siteId = await resolveAnalyticsSiteId({ headers: req.headers });
  const raw = await req.json().catch(() => null);
  const normalized = normalizeAnalyticsEvent(raw);
  if (!normalized) {
    return new NextResponse("Invalid analytics event payload", { status: 400 });
  }

  await emitAnalyticsEvent({
    ...normalized,
    siteId: normalized.siteId || siteId,
  });

  return new NextResponse("accepted", { status: 202 });
}
