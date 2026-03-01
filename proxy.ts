import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAdminPathAlias } from "@/lib/admin-path";

function normalizeConfiguredHost(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function isTruthy(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isDebugModeEdge() {
  const raw = process.env.DEBUG_MODE || process.env.NEXT_PUBLIC_DEBUG_MODE || "";
  if (isTruthy(raw)) return true;
  return process.env.NODE_ENV === "development";
}

function getTraceTier() {
  const configured = (process.env.TRACE_PROFILE || "").trim().toLowerCase();
  if (configured === "test") return "Test";
  if (configured === "prod" || configured === "production") return "Prod";
  if (configured === "dev" || configured === "development") return "Dev";
  if (process.env.NODE_ENV === "production") return "Prod";
  if (process.env.NODE_ENV === "test") return "Test";
  return "Dev";
}

function traceEdge(scope: string, message: string, payload?: unknown) {
  if (!isDebugModeEdge()) return;
  const tier = getTraceTier();
  if (payload === undefined) {
    console.debug(`[trace:${tier}:${scope}] ${message}`);
    return;
  }
  console.debug(`[trace:${tier}:${scope}] ${message}`, payload);
}

function hasSessionCookie(req: NextRequest) {
  return Boolean(
    req.cookies.get("__Secure-next-auth.session-token")?.value ||
      req.cookies.get("next-auth.session-token")?.value ||
      req.cookies.get("__Secure-authjs.session-token")?.value ||
      req.cookies.get("authjs.session-token")?.value,
  );
}

function isAllowedAppCallback(rawUrl: string) {
  const value = String(rawUrl || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostname = String(url.hostname || "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function readLastSiteId(req: NextRequest) {
  return String(
    req.cookies.get("cms_last_site_id")?.value ||
      req.cookies.get("tooty_last_site_id")?.value ||
      "",
  ).trim();
}

function readLastAppPath(req: NextRequest) {
  const value = String(
    req.cookies.get("cms_last_admin_path")?.value ||
      req.cookies.get("tooty_last_app_path")?.value ||
      "",
  ).trim();
  if (!value.startsWith("/site/")) return "";
  return value;
}

function setLastSiteId(res: NextResponse, siteId: string) {
  const normalized = String(siteId || "").trim();
  if (!normalized) return;
  res.cookies.set("cms_last_site_id", normalized, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: false,
  });
}

function setLastAppPath(res: NextResponse, appPath: string) {
  const normalized = String(appPath || "").trim();
  if (!normalized.startsWith("/site/")) return;
  res.cookies.set("cms_last_admin_path", normalized, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: false,
  });
}

function normalizeAdminAliasPath(path: string, adminPathAlias: string) {
  const raw = String(path || "").trim() || "/";
  if (raw === "/" || raw === "/app" || raw === `/${adminPathAlias}`) return "/";
  if (raw.startsWith("/app/")) return raw.slice(4) || "/";
  if (raw.startsWith(`/${adminPathAlias}/`)) return raw.slice(adminPathAlias.length + 1) || "/";
  return raw;
}

export const config = {
  matcher: [
    "/((?!api/|_next/|_static/|_vercel|media/|sitemap\\.xml|robots\\.txt|.*\\..*).*)",
  ],
};

export default async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;
  const searchParams = url.searchParams.toString();
  const fullPath = `${path}${searchParams ? `?${searchParams}` : ""}`;
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);

  const rewriteWithTrace = (to: string) => {
    const res = NextResponse.rewrite(new URL(to, req.url), {
      request: { headers: requestHeaders },
    });
    res.headers.set("x-trace-id", traceId);
    return res;
  };
  const nextWithTrace = () => {
    const res = NextResponse.next({
      request: { headers: requestHeaders },
    });
    res.headers.set("x-trace-id", traceId);
    return res;
  };
  const preserveWithTrace = (to: string) =>
    process.env.NODE_ENV === "test" ? rewriteWithTrace(to) : nextWithTrace();
  const redirectWithTrace = (to: string) => {
    const res = NextResponse.redirect(new URL(to, req.url));
    res.headers.set("x-trace-id", traceId);
    return res;
  };
  const normalizedRootDomain =
    normalizeConfiguredHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "") || "localhost";
  const adminPathAlias = getAdminPathAlias();
  traceEdge("middleware", "incoming request", {
    traceId,
    path,
    search: searchParams,
    host: req.headers.get("host"),
  });

  const hostHeader = req.headers.get("host") || "";
  let hostname = hostHeader.split(":")[0].toLowerCase();

  // Normalize local subdomains for any localhost port.
  if (hostname.endsWith(".localhost")) {
    hostname = hostname.replace(".localhost", `.${normalizedRootDomain}`);
  }

  // In local dev/e2e we route *.test through localhost semantics.
  if (normalizedRootDomain === "localhost" && hostname.endsWith(".test")) {
    hostname = hostname.replace(/\.test$/, ".localhost");
  }

  // Normalize Vercel preview deployment URLs.
  // Handles both "<branch>---<project>.vercel.app" and
  // "<project>-<hash>-<scope>.vercel.app" URL shapes by treating preview hosts
  // as root-domain requests.
  const vercelSuffix = process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX || "vercel.app";
  if (hostname.endsWith(`.${vercelSuffix}`)) {
    if (hostname.includes("---")) {
      hostname = `${hostname.split("---")[0]}.${normalizedRootDomain}`;
    } else {
      hostname = normalizedRootDomain;
    }
  }

  const MAIN_SUBDOMAIN = "main";
  const mainDomainKey = `${MAIN_SUBDOMAIN}.${normalizedRootDomain}`;
  const isMainAliasDomain = hostname === mainDomainKey;
  if (isMainAliasDomain) {
    // Treat main.<root> as root-domain alias to avoid cross-host redirect loops in middleware.
    hostname = normalizedRootDomain === "localhost" ? "localhost" : normalizedRootDomain;
  }

  const isRootDomain =
    hostname === "localhost" || hostname === normalizedRootDomain;

  // ✅ Keep setup route reachable on root domain.
  if (isRootDomain && path.startsWith("/setup")) {
    traceEdge("middleware", "preserve setup path on root", { traceId, to: fullPath });
    return preserveWithTrace(fullPath);
  }

  const externalAdminBase = `/app/${adminPathAlias}`;
  const isExternalAdminPath =
    path === externalAdminBase || path.startsWith(`${externalAdminBase}/`);

  if (isRootDomain && isExternalAdminPath) {
    const appPath = normalizeAdminAliasPath(path.replace(/^\/app/, ""), adminPathAlias);
    const appFullPath = `${appPath}${searchParams ? `?${searchParams}` : ""}`;
    traceEdge("middleware", "rewrite external admin alias path on root", { traceId, to: `/app${appPath === "/" ? "" : appFullPath}` });

    const hasCookie = hasSessionCookie(req);
    const sessionToken = hasCookie
      ? await getToken({
          req,
          secret: process.env.NEXTAUTH_SECRET,
        })
      : null;
    const isAuthenticated = Boolean(sessionToken);
    const forcePasswordChange = Boolean((sessionToken as any)?.forcePasswordChange);
    const isPublicBridgePath = appPath === "/theme-bridge-client" || appPath === "/theme-bridge-start";
    if (!isAuthenticated && appPath !== "/login" && !isPublicBridgePath) {
      traceEdge("middleware", "redirect unauthenticated admin-path user", { traceId, to: `${externalAdminBase}/login` });
      return redirectWithTrace(`${externalAdminBase}/login`);
    }
    if (isAuthenticated && appPath === "/login") {
      const callbackUrl = String(req.nextUrl.searchParams.get("callbackUrl") || "").trim();
      if (callbackUrl && isAllowedAppCallback(callbackUrl)) {
        traceEdge("middleware", "redirect authenticated admin-path user to callback", { traceId, to: callbackUrl });
        const res = NextResponse.redirect(callbackUrl);
        res.headers.set("x-trace-id", traceId);
        return res;
      }
      traceEdge("middleware", "redirect authenticated admin-path user", { traceId, to: externalAdminBase });
      return redirectWithTrace(externalAdminBase);
    }
    if (isAuthenticated && (appPath === "/" || appPath === "")) {
      const lastAppPath = readLastAppPath(req);
      if (lastAppPath) {
        traceEdge("middleware", "redirect admin-path root to last path", {
          traceId,
          to: `${externalAdminBase}${lastAppPath}`,
        });
        return redirectWithTrace(`${externalAdminBase}${lastAppPath}`);
      }
      const lastSiteId = readLastSiteId(req);
      if (lastSiteId) {
        traceEdge("middleware", "redirect admin-path root to last site", {
          traceId,
          to: `${externalAdminBase}/site/${lastSiteId}`,
        });
        return redirectWithTrace(`${externalAdminBase}/site/${lastSiteId}`);
      }
    }
    if (isAuthenticated && (appPath === "/sites" || appPath === "/sites/")) {
      const lastAppPath = readLastAppPath(req);
      if (lastAppPath) {
        traceEdge("middleware", "redirect admin-path /sites to last path", {
          traceId,
          to: `${externalAdminBase}${lastAppPath}`,
        });
        return redirectWithTrace(`${externalAdminBase}${lastAppPath}`);
      }
      const lastSiteId = readLastSiteId(req);
      if (lastSiteId) {
        traceEdge("middleware", "redirect admin-path /sites to last site", {
          traceId,
          to: `${externalAdminBase}/site/${lastSiteId}`,
        });
        return redirectWithTrace(`${externalAdminBase}/site/${lastSiteId}`);
      }
      traceEdge("middleware", "redirect admin-path /sites to admin root", { traceId, to: externalAdminBase });
      return redirectWithTrace(externalAdminBase);
    }
    if (
      isAuthenticated &&
      forcePasswordChange &&
      appPath !== "/settings/profile" &&
      !appPath.startsWith("/settings/profile?")
    ) {
      traceEdge("middleware", "force password change redirect", {
        traceId,
        to: `${externalAdminBase}/settings/profile?forcePasswordChange=1`,
      });
      return redirectWithTrace(`${externalAdminBase}/settings/profile?forcePasswordChange=1`);
    }

    const rewritten = rewriteWithTrace(`/app${appPath === "/" ? "" : appFullPath}`);
    const siteMatch = appPath.match(/^\/site\/([^/?#]+)/);
    if (siteMatch?.[1]) {
      setLastSiteId(rewritten, decodeURIComponent(siteMatch[1]));
      setLastAppPath(rewritten, appPath);
    }
    return rewritten;
  }

  if (isRootDomain && (path === "/app" || path.startsWith("/app/"))) {
    const cleanPath = normalizeAdminAliasPath(path, adminPathAlias);
    const target = `/app/${adminPathAlias}${cleanPath === "/" ? "" : cleanPath}${searchParams ? `?${searchParams}` : ""}`;
    traceEdge("middleware", "redirect internal app path to admin alias", { traceId, to: target });
    return redirectWithTrace(target);
  }

  // Preserve direct dashboard routes on localhost/root domain.
  // ✅ Root homepage serves primary site directly.
  if (isRootDomain && path === "/") {
    traceEdge("middleware", "preserve root homepage", { traceId, to: "/" });
    return preserveWithTrace("/");
  }

  // Keep /home namespace reachable directly.
  if (isRootDomain && path.startsWith("/home")) {
    traceEdge("middleware", "preserve /home path on root", { traceId, to: fullPath });
    return preserveWithTrace(fullPath);
  }

  // 🧭 Root site rewrites non-app paths to the primary site content.
  // Example: /welcome-to-tooty -> /main/welcome-to-tooty
  if (isRootDomain) {
    traceEdge("middleware", "rewrite root to primary site", {
      traceId,
      to: `/${mainDomainKey}${fullPath}`,
    });
    return rewriteWithTrace(`/${mainDomainKey}${fullPath}`);
  }

  // 🌐 All other subdomains use dynamic site routing
  traceEdge("middleware", "rewrite tenant domain", { traceId, to: `/${hostname}${fullPath}` });
  return rewriteWithTrace(`/${hostname}${fullPath}`);
}
