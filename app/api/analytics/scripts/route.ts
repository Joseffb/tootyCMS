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
import { isLocalHostLike } from "@/lib/site-url";

type AnalyticsScript = {
  id: string;
  src?: string;
  inline?: string;
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive";
  attrs?: Record<string, string>;
};

function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function isLocalRequest(req: NextRequest) {
  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) || firstHeaderValue(req.headers.get("host"));
  return isLocalHostLike(host);
}

export async function GET(req: NextRequest) {
  const localRequest = isLocalRequest(req);
  const gpcEnabled = isGpcEnabled(req.headers.get("sec-gpc"));
  const consent = parseAnalyticsConsent(
    req.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value ??
      req.cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE)?.value,
  );
  if (!localRequest && !shouldCollectAnalytics({ consent, gpcEnabled })) {
    return NextResponse.json({ scripts: [] });
  }

  const siteId = await resolveAnalyticsSiteId({ headers: req.headers });
  const kernel = await createKernelForRequest(siteId);
  const scripts = await kernel.applyFilters<AnalyticsScript[]>("domain:scripts", [], {
    request: req,
    siteId: siteId || null,
  });

  return NextResponse.json({
    scripts: Array.isArray(scripts) ? scripts.filter((item) => item && item.id) : [],
  });
}
