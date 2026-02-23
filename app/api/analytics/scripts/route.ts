import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { resolveAnalyticsSiteId } from "@/lib/analytics-site";
import {
  ANALYTICS_CONSENT_COOKIE,
  LEGACY_ANALYTICS_CONSENT_COOKIE,
  isGpcEnabled,
  parseAnalyticsConsent,
  shouldCollectAnalytics,
} from "@/lib/privacy-consent";

type AnalyticsScript = {
  id: string;
  src?: string;
  inline?: string;
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive";
  attrs?: Record<string, string>;
};

export async function GET(req: NextRequest) {
  const gpcEnabled = isGpcEnabled(req.headers.get("sec-gpc"));
  const consent = parseAnalyticsConsent(
    req.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value ??
      req.cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE)?.value,
  );
  if (!shouldCollectAnalytics({ consent, gpcEnabled })) {
    return NextResponse.json({ scripts: [] });
  }

  const siteId = await resolveAnalyticsSiteId({ headers: req.headers });
  const kernel = await createKernelForRequest(siteId);
  const scripts = await kernel.applyFilters<AnalyticsScript[]>("analytics:scripts", [], {
    request: req,
    siteId: siteId || null,
  });

  return NextResponse.json({
    scripts: Array.isArray(scripts) ? scripts.filter((item) => item && item.id) : [],
  });
}

