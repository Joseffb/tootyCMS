'use client';

import { useEffect, useState } from 'react';
import { track } from '@/components/track';
import Cookies from 'js-cookie';
import { usePathname } from "next/navigation";
import Script from "next/script";
import {
  ANALYTICS_CONSENT_COOKIE,
  LEGACY_ANALYTICS_CONSENT_COOKIE,
  isGpcEnabled,
  parseAnalyticsConsent,
  shouldCollectAnalytics,
} from "@/lib/privacy-consent";

export default function AnalyticsConditional() {
  const pathname = usePathname();
  const [isAdminArea, setIsAdminArea] = useState(false);
  const [consentConfig, setConsentConfig] = useState<{
    enabled: boolean;
    bannerMessage: string;
    acceptText: string;
    declineText: string;
    denyOnDismiss: boolean;
  }>({
    enabled: false,
    bannerMessage: "We use anonymous analytics to improve this site.",
    acceptText: "Accept",
    declineText: "Decline",
    denyOnDismiss: true,
  });
  const [showConsentModal, setShowConsentModal] = useState(false);

  const [allowed, setAllowed] = useState(() => {
    const consent = parseAnalyticsConsent(
      Cookies.get(ANALYTICS_CONSENT_COOKIE) || Cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE),
    );
    return shouldCollectAnalytics({ consent, gpcEnabled: false });
  });
  const [scripts, setScripts] = useState<Array<{
    id: string;
    src?: string;
    inline?: string;
    strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive";
    attrs?: Record<string, string>;
  }>>([]);

  const persistConsent = (value: "true" | "false", expires: Date | number) => {
    Cookies.set(ANALYTICS_CONSENT_COOKIE, value, { expires, path: "/" });
    Cookies.set(LEGACY_ANALYTICS_CONSENT_COOKIE, value, { expires, path: "/" });
  };

  const denyConsent = () => {
    persistConsent("false", 1);
    setAllowed(false);
    setShowConsentModal(false);

    Cookies.remove("ga");
    Cookies.remove("_vercel_analytics");
    Cookies.remove("_vercel_analytics_id");
    localStorage.clear();
    sessionStorage.clear();
  };

  const grantConsent = () => {
    const gpcEnabled = isGpcEnabled(String((navigator as any)?.globalPrivacyControl ?? ""));
    if (gpcEnabled) {
      denyConsent();
      return;
    }
    persistConsent("true", new Date("2026-01-01T00:00:00Z"));
    setAllowed(true);
    setShowConsentModal(false);
  };

  useEffect(() => {
    const host = window.location.host || "";
    setIsAdminArea(pathname.startsWith("/app") || host.startsWith("app."));
  }, [pathname]);

  useEffect(() => {
    if (isAdminArea) return;
    fetch("/api/privacy/consent", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return;
        setConsentConfig({
          enabled: Boolean(json.enabled),
          bannerMessage: String(json.bannerMessage || "We use anonymous analytics to improve this site."),
          acceptText: String(json.acceptText || "Accept"),
          declineText: String(json.declineText || "Decline"),
          denyOnDismiss: Boolean(json.denyOnDismiss),
        });
      })
      .catch(() => undefined);
  }, [isAdminArea]);

  useEffect(() => {
    const gpcEnabled = isGpcEnabled(String((navigator as any)?.globalPrivacyControl ?? ""));
    if (!gpcEnabled) return;
    persistConsent("false", 365);
    setAllowed(false);
    setShowConsentModal(false);
  }, []);

  useEffect(() => {
    if (isAdminArea || !consentConfig.enabled) {
      setShowConsentModal(false);
      return;
    }
    const consent = parseAnalyticsConsent(
      Cookies.get(ANALYTICS_CONSENT_COOKIE) || Cookies.get(LEGACY_ANALYTICS_CONSENT_COOKIE),
    );
    setShowConsentModal(consent === "unknown");
  }, [isAdminArea, consentConfig.enabled]);

  // fire a page-view on mount or whenever we flip from denied→allowed
  useEffect(() => {
    if (allowed) {
      track(window.location.pathname);
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed || isAdminArea) {
      setScripts([]);
      return;
    }
    fetch("/api/analytics/scripts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { scripts: [] }))
      .then((json) => {
        setScripts(Array.isArray(json?.scripts) ? json.scripts : []);
      })
      .catch(() => setScripts([]));
  }, [allowed, isAdminArea]);

  return (
    <>
      {!isAdminArea && showConsentModal ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xl rounded-xl border border-stone-300 bg-white p-5 shadow-2xl dark:border-stone-700 dark:bg-stone-900">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Privacy Preferences</h3>
              <button
                type="button"
                aria-label="Close consent dialog"
                className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                onClick={() => {
                  if (consentConfig.denyOnDismiss) {
                    denyConsent();
                    return;
                  }
                  setShowConsentModal(false);
                }}
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-sm text-stone-700 dark:text-stone-300">{consentConfig.bannerMessage}</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
                onClick={denyConsent}
              >
                {consentConfig.declineText}
              </button>
              <button
                type="button"
                className="rounded-md border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
                onClick={grantConsent}
              >
                {consentConfig.acceptText}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {scripts.map((script) =>
        script.src ? (
          <Script
            key={script.id}
            id={script.id}
            src={script.src}
            strategy={script.strategy || "afterInteractive"}
            {...(script.attrs || {})}
          />
        ) : (
          <Script
            key={script.id}
            id={script.id}
            strategy={script.strategy || "afterInteractive"}
            {...(script.attrs || {})}
          >
            {script.inline || ""}
          </Script>
        ),
      )}
    </>
  );
}
