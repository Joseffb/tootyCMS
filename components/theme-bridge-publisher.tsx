"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tooty.themeAuthBridge.v1";

export default function ThemeBridgePublisher() {
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch("/api/auth/theme-bridge-token", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && payload?.authenticated && payload?.token) {
          const stored = {
            token: String(payload.token),
            user: payload.user || null,
            updatedAt: Date.now(),
          };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // keep existing cached token if refresh fails transiently
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}

