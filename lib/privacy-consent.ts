export type AnalyticsConsent = "unknown" | "granted" | "denied";

export const ANALYTICS_CONSENT_COOKIE = "tooty_analytics_consent";
export const LEGACY_ANALYTICS_CONSENT_COOKIE = "rb_analytics_consent";

export function parseAnalyticsConsent(raw: string | null | undefined): AnalyticsConsent {
  const normalized = String(raw || "").trim().toLowerCase();
  if (["true", "1", "yes", "accept", "accepted", "granted"].includes(normalized)) return "granted";
  if (["false", "0", "no", "decline", "declined", "denied"].includes(normalized)) return "denied";
  return "unknown";
}

export function isGpcEnabled(raw: string | null | undefined): boolean {
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function shouldCollectAnalytics(input: {
  consent: AnalyticsConsent;
  gpcEnabled: boolean;
}) {
  if (input.gpcEnabled) return false;
  return input.consent === "granted";
}
