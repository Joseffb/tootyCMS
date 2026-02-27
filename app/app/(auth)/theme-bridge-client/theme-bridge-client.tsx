"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tooty.themeAuthBridge.v1";

function isAllowedOrigin(rawOrigin: string) {
  const value = String(rawOrigin || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
    return false;
  } catch {
    return false;
  }
}

export default function ThemeBridgeClient() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const origin = String(params.get("origin") || "").trim();
    if (!isAllowedOrigin(origin)) return;

    let cancelled = false;

    const postPayload = (payload: { token?: string; user?: Record<string, unknown> | null } | null) => {
      if (cancelled) return;
      window.parent?.postMessage(
        {
          type: "tooty-theme-auth-bridge",
          payload: payload || {},
        },
        origin,
      );
    };

    async function resolvePayload() {
      try {
        const response = await fetch("/api/auth/theme-bridge-token", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.authenticated && payload?.token) {
          const stored = {
            token: String(payload.token),
            user: payload.user || null,
            updatedAt: Date.now(),
          };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
          postPayload(stored);
          return;
        }
      } catch {
        // Fallback to locally cached bridge payload when token refresh fails.
      }

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const payload = raw ? JSON.parse(raw) : null;
        postPayload(payload);
      } catch {
        postPayload(null);
      }
    }

    void resolvePayload();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
