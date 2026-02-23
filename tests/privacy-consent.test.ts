import { describe, expect, it } from "vitest";
import { parseAnalyticsConsent, shouldCollectAnalytics } from "@/lib/privacy-consent";

describe("privacy consent", () => {
  it("treats unknown consent as no tracking", () => {
    expect(shouldCollectAnalytics({ consent: "unknown", gpcEnabled: false })).toBe(false);
  });

  it("tracks only when consent is granted", () => {
    expect(shouldCollectAnalytics({ consent: "granted", gpcEnabled: false })).toBe(true);
    expect(shouldCollectAnalytics({ consent: "denied", gpcEnabled: false })).toBe(false);
  });

  it("never tracks when GPC is enabled", () => {
    expect(shouldCollectAnalytics({ consent: "granted", gpcEnabled: true })).toBe(false);
  });

  it("parses unknown values as unknown", () => {
    expect(parseAnalyticsConsent(undefined)).toBe("unknown");
    expect(parseAnalyticsConsent("")).toBe("unknown");
    expect(parseAnalyticsConsent("maybe")).toBe("unknown");
  });
});
