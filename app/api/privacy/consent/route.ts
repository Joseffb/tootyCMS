import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsSiteId } from "@/lib/analytics-site";
import { listPluginsWithSiteState } from "@/lib/plugins";

const DEFAULTS = {
  enabled: false,
  bannerMessage: "We use anonymous analytics to improve this site.",
  acceptText: "Accept",
  declineText: "Decline",
  denyOnDismiss: true,
};

function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export async function GET(req: NextRequest) {
  const siteId = await resolveAnalyticsSiteId({ headers: req.headers });
  if (!siteId) return NextResponse.json(DEFAULTS);

  const plugins = await listPluginsWithSiteState(siteId);
  const gdpr = plugins.find((plugin) => plugin.id === "gdpr-consent" && plugin.enabled && plugin.siteEnabled);
  if (!gdpr) return NextResponse.json(DEFAULTS);

  const config = gdpr.effectiveConfig || {};
  return NextResponse.json({
    enabled: true,
    bannerMessage: String(config.bannerMessage || DEFAULTS.bannerMessage).trim() || DEFAULTS.bannerMessage,
    acceptText: String(config.acceptText || DEFAULTS.acceptText).trim() || DEFAULTS.acceptText,
    declineText: String(config.declineText || DEFAULTS.declineText).trim() || DEFAULTS.declineText,
    denyOnDismiss: asBoolean(config.denyOnDismiss, DEFAULTS.denyOnDismiss),
  });
}

