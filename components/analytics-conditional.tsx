'use client';

import { useEffect, useState } from 'react';
import CookieConsent from 'react-cookie-consent';
import { Analytics } from '@vercel/analytics/react';
import { track } from '@/components/track';
import Cookies from 'js-cookie';
import { usePathname } from "next/navigation";

export default function AnalyticsConditional() {
  const pathname = usePathname();
  const [isAdminArea, setIsAdminArea] = useState(false);

  // default to tracking unless the cookie is explicitly "false"
  const [allowed, setAllowed] = useState(() => {
    const consent = Cookies.get('rb_analytics_consent');
    return consent !== 'false';
  });

  useEffect(() => {
    const host = window.location.host || "";
    setIsAdminArea(pathname.startsWith("/app") || host.startsWith("app."));
  }, [pathname]);

  // fire a page-view on mount or whenever we flip from denied→allowed
  useEffect(() => {
    if (allowed) {
      track(window.location.pathname);
    }
  }, [allowed]);

  return (
    <>
      {!isAdminArea && <CookieConsent
        containerClasses="rb-cookie-consent-banner"
        location="bottom"
        buttonText="Accept"
        declineButtonText="Decline"
        enableDeclineButton

        onAccept={() => {
          // consent = 'true' until Jan 1 2026
          Cookies.set("rb_analytics_consent", "true", {
            expires: new Date("2026-01-01T00:00:00Z"),
            path: "/",
          });
          setAllowed(true);
        }}

        onDecline={() => {
          // consent = 'false' until tomorrow
          Cookies.set("rb_analytics_consent", "false", {
            expires: 1,   // 1 day
            path: "/",
          });
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

      {!isAdminArea && allowed && <Analytics />}
    </>
  );
}
