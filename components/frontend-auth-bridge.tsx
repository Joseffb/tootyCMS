"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tooty.themeAuthBridge.v1";
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 1800;

type BridgeUser = {
  id?: string;
  email?: string;
  username?: string;
  name?: string;
  displayName?: string;
};

type BridgeAuth = {
  ready: boolean;
  token: string;
  user: BridgeUser | null;
};

declare global {
  interface Window {
    __tootyFrontendAuth?: BridgeAuth;
    __tootyFrontendAuthLoggedOut?: boolean;
    __tootyThemeFrontendLoggedOut?: boolean;
    __tootyResolveFrontendAuth?: () => Promise<BridgeAuth>;
    __tootyPingFrontendBridge?: (mode?: "silent" | "interactive") => Promise<BridgeAuth>;
  }
}

function deriveAppOrigin() {
  const protocol = window.location.protocol || "http:";
  const port = window.location.port ? `:${window.location.port}` : "";
  const hostname = String(window.location.hostname || "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return `${protocol}//app.localhost${port}`;
  }
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return `${protocol}//app.${parts.slice(-2).join(".")}${port}`;
  }
  return `${protocol}//app.${hostname}${port}`;
}

function consumeHashPayload() {
  const rawHash = String(window.location.hash || "");
  if (!rawHash || rawHash.length < 2) return null;
  const hashParams = new URLSearchParams(rawHash.slice(1));
  const token = String(hashParams.get("tootyBridgeToken") || "").trim();
  const displayName = String(hashParams.get("tootyBridgeDisplayName") || "").trim();
  const attempted = hashParams.get("tootyBridgeAttempted") === "1";
  if (!token && !attempted) return null;
  if (window.history && typeof window.history.replaceState === "function") {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return {
    token,
    user: displayName ? ({ displayName } as BridgeUser) : null,
  };
}

function readStoredPayload() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const token = String(payload?.token || "").trim();
    if (!token) return null;
    return {
      token,
      user: payload?.user || null,
    };
  } catch {
    return null;
  }
}

function persistPayload(payload: { token?: string; user?: BridgeUser | null }) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: String(payload?.token || ""),
        user: payload?.user || null,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // best effort cache
  }
}

function buildLoginHref() {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({
    return: returnTo,
    mode: "interactive",
    cb: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return `${deriveAppOrigin()}/theme-bridge-start?${params.toString()}`;
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGreeting(user: BridgeUser | null) {
  const targets = Array.from(document.querySelectorAll("[data-theme-auth-greeting], .tooty-post-auth"));
  const greeting = String(user?.displayName || user?.username || user?.name || "").trim();
  for (const node of targets) {
    if (!(node instanceof HTMLElement)) continue;
    if (greeting) {
      node.textContent = `Hello ${greeting}`;
    } else {
      const loginHref = buildLoginHref();
      node.innerHTML = `<a class="tooty-post-link" href="${escapeHtml(loginHref)}">Login</a>`;
    }
    if (node.hasAttribute("data-theme-auth-greeting")) node.removeAttribute("hidden");
  }
}

async function fetchBridgeAuth(mode: "silent" | "interactive" = "silent") {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = window.setTimeout(() => {
    if (controller) controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({ mode });
    const response = await fetch(`${deriveAppOrigin()}/api/auth/theme-bridge-token?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.authenticated && data?.token) {
      return {
        token: String(data.token || ""),
        user: (data.user || null) as BridgeUser | null,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function FrontendAuthBridge() {
  useEffect(() => {
    let cancelled = false;
    let bridgePromise: Promise<BridgeAuth> | null = null;

    const resolveAuth = async (mode: "silent" | "interactive" = "silent"): Promise<BridgeAuth> => {
      const current = window.__tootyFrontendAuth;
      if (current?.ready && current.token) return current;
      if (bridgePromise) return bridgePromise;

      bridgePromise = (async () => {
        let payload = consumeHashPayload();
        if (payload?.token) {
          persistPayload(payload);
        } else {
          payload = readStoredPayload();
        }

        if (!payload?.token) {
          for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            const fetched = await fetchBridgeAuth(mode);
            if (fetched?.token) {
              payload = fetched;
              persistPayload(payload);
              break;
            }
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 1200 * (attempt + 1)));
            }
          }
        }

        const auth: BridgeAuth = {
          ready: true,
          token: String(payload?.token || ""),
          user: payload?.user || null,
        };
        window.__tootyFrontendAuth = auth;
        window.__tootyFrontendAuthLoggedOut = !auth.token;
        window.__tootyThemeFrontendLoggedOut = !auth.token;
        if (!cancelled) {
          renderGreeting(auth.user);
          window.dispatchEvent(new CustomEvent("tooty:auth-changed", { detail: auth }));
        }
        if (!auth.token) bridgePromise = null;
        return auth;
      })();
      return bridgePromise;
    };

    window.__tootyResolveFrontendAuth = () => resolveAuth("silent");
    window.__tootyPingFrontendBridge = (mode = "silent") => resolveAuth(mode);
    renderGreeting(window.__tootyFrontendAuth?.user || null);
    void resolveAuth("silent");

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
