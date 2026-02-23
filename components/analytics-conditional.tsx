'use client';

import { useEffect, useState } from 'react';
import CookieConsent from 'react-cookie-consent';
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

  useEffect(() => {
    const host = window.location.host || "";
    setIsAdminArea(pathname.startsWith("/app") || host.startsWith("app."));
  }, [pathname]);

  useEffect(() => {
    const gpcEnabled = isGpcEnabled(String((navigator as any)?.globalPrivacyControl ?? ""));
    if (!gpcEnabled) return;
    persistConsent("false", 365);
    setAllowed(false);
  }, []);

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
      {!isAdminArea && <CookieConsent
        containerClasses="rb-cookie-consent-banner"
        location="bottom"
        buttonText="Accept"
        declineButtonText="Decline"
        enableDeclineButton

        onAccept={() => {
          const gpcEnabled = isGpcEnabled(String((navigator as any)?.globalPrivacyControl ?? ""));
          if (gpcEnabled) {
            persistConsent("false", 365);
            setAllowed(false);
            return;
          }
          // consent = 'true' until Jan 1 2026
          persistConsent("true", new Date("2026-01-01T00:00:00Z"));
          setAllowed(true);
        }}

        onDecline={() => {
          // consent = 'false' until tomorrow
          persistConsent("false", 1); // 1 day
          setAllowed(false);

          // remove other tracking cookies (not the consent cookie)
          Cookies.remove("ga");
          Cookies.remove("_vercel_analytics");
          Cookies.remove("_vercel_analytics_id");

          // clear storage
          localStorage.clear();
          sessionStorage.clear();
        }}
      >
        We use anonymous analytics to improve this site.
      </CookieConsent>}

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
