import { NextRequest, NextResponse } from "next/server";
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

export const config = {
  matcher: [
    "/((?!api/|_next/|_static/|_vercel|media/|sitemap\\.xml|robots\\.txt|.*\\..*).*)",
  ],
};

export default async function middleware(req: NextRequest) {
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
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
  const normalizedRootDomain = rootDomain.replace(/:\d+$/, "");
  traceEdge("middleware", "incoming request", {
    traceId,
    path,
    search: searchParams,
    host: req.headers.get("host"),
  });

  const hostHeader = req.headers.get("host") || "";
  let hostname = hostHeader.split(":")[0];

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
  // as root-domain requests unless they explicitly target app.<root>.
  const vercelSuffix = process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX || "vercel.app";
  if (hostname.endsWith(`.${vercelSuffix}`)) {
    if (hostname.includes("---")) {
      hostname = `${hostname.split("---")[0]}.${normalizedRootDomain}`;
    } else if (hostname.startsWith("app-")) {
      hostname = `app.${normalizedRootDomain}`;
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

  const isAppDomain = hostname === `app.${normalizedRootDomain}`;

  // 🧠 APP subdomain
  if (isAppDomain) {
    const appPath = path.startsWith("/app")
      ? path.replace(/^\/app/, "") || "/"
      : path;
    const appFullPath = `${appPath}${searchParams ? `?${searchParams}` : ""}`;

    traceEdge("middleware", "app-domain route", { hostname, path });
    if (appPath === "/setup") {
      traceEdge("middleware", "allow setup on app-domain", { traceId, to: "/setup" });
      return preserveWithTrace("/setup");
    }
    const session = hasSessionCookie(req);
    if (!session && appPath !== "/login") {
      traceEdge("middleware", "redirect unauthenticated app user", { traceId, to: "/login" });
      return redirectWithTrace("/login");
    }
    if (session && appPath === "/login") {
      traceEdge("middleware", "redirect authenticated app user", { traceId, to: "/" });
      return redirectWithTrace("/");
    }
    traceEdge("middleware", "rewrite app-domain", {
      traceId,
      to: `/app${appPath === "/" ? "" : appFullPath}`,
    });
    return rewriteWithTrace(`/app${appPath === "/" ? "" : appFullPath}`);
  }

  // ✅ Keep setup route reachable on root domain.
  if (isRootDomain && path.startsWith("/setup")) {
    traceEdge("middleware", "preserve setup path on root", { traceId, to: fullPath });
    return preserveWithTrace(fullPath);
  }

  // Preserve direct dashboard routes on localhost/root domain.
  if (isRootDomain && path.startsWith("/app")) {
    traceEdge("middleware", "preserve direct app path on root", { traceId, to: fullPath });
    return preserveWithTrace(fullPath);
  }

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
