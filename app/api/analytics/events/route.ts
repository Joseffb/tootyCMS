import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import {
  ANALYTICS_CONSENT_COOKIE,
  LEGACY_ANALYTICS_CONSENT_COOKIE,
  isGpcEnabled,
  parseAnalyticsConsent,
  shouldCollectAnalytics,
} from "@/lib/privacy-consent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gpcEnabled = isGpcEnabled(req.headers.get("sec-gpc"));
  const consent = parseAnalyticsConsent(
    req.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value ??
      req.cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE)?.value,
  );
  if (!shouldCollectAnalytics({ consent, gpcEnabled })) {
    return new NextResponse("Analytics disabled by privacy preference", { status: 202 });
  }

  const kernel = await createKernelForRequest();
  const response = await kernel.applyFilters<Response | NextResponse | null>(
    "analytics:ingest",
    null,
    { request: req },
  );

  if (!response) return new NextResponse("No analytics provider registered; event skipped", { status: 202 });
  if (response instanceof NextResponse) return response;
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
