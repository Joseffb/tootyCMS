function normalizeHostInput(value: string | null | undefined) {
  return (value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:(\d+):\1$/, ":$1");
}

function splitHostAndPort(host: string) {
  const normalized = normalizeHostInput(host);
  const match = normalized.match(/^(.*?)(?::(\d+))?$/);
  return {
    host: (match?.[1] || normalized).toLowerCase(),
    port: match?.[2] || "",
  };
}

export function isLocalHostLike(host: string) {
  const { host: bareHost } = splitHostAndPort(host);
  return (
    bareHost === "localhost" ||
    bareHost.endsWith(".localhost") ||
    bareHost.endsWith(".test")
  );
}

function resolveLocalPort() {
  if (typeof window !== "undefined" && window.location.port) {
    return window.location.port;
  }

  let port = process.env.PORT || "3000";
  const nextAuthUrl = (process.env.NEXTAUTH_URL || "").trim();
  if (nextAuthUrl) {
    try {
      const parsed = new URL(nextAuthUrl);
      if (parsed.port) port = parsed.port;
    } catch {
      // keep fallback
    }
  }
  return port;
}

function withLocalPortIfNeeded(host: string, protocol: "http" | "https") {
  const normalized = normalizeHostInput(host);
  if (!normalized) return normalized;
  const { port } = splitHostAndPort(normalized);
  if (port) return normalized;
  if (protocol === "http" && isLocalHostLike(normalized)) {
    return `${normalized}:${resolveLocalPort()}`;
  }
  return normalized;
}

function rootDomainFromEnv() {
  return normalizeHostInput(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "");
}

export function getRootSiteUrl() {
  const rootDomain = rootDomainFromEnv();
  if (process.env.NEXT_PUBLIC_VERCEL_ENV && rootDomain) {
    return `https://${splitHostAndPort(rootDomain).host}`;
  }

  if (rootDomain) {
    const protocol: "http" | "https" = isLocalHostLike(rootDomain)
      ? "http"
      : "https";
    const host = withLocalPortIfNeeded(rootDomain, protocol);
    return `${protocol}://${host}`;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return `http://localhost:${resolveLocalPort()}`;
}

export function withLocalDevPort(url: string) {
  const trimmed = url.trim();
  if (!trimmed || process.env.NEXT_PUBLIC_VERCEL_ENV) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.port) return `${parsed.protocol}//${parsed.host}`;
    const rootDomain = rootDomainFromEnv().replace(/:\d+$/, "").toLowerCase();
    if (!rootDomain || parsed.hostname.toLowerCase() !== rootDomain) {
      return `${parsed.protocol}//${parsed.host}`;
    }

    const port = resolveLocalPort();
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
  } catch {
    return trimmed;
  }
}

export function getSitePublicUrl(input: {
  subdomain?: string | null;
  customDomain?: string | null;
  isPrimary?: boolean;
}) {
  if (input.customDomain) {
    const customHost = normalizeHostInput(input.customDomain);
    const protocol: "http" | "https" = isLocalHostLike(customHost)
      ? "http"
      : "https";
    const host = withLocalPortIfNeeded(customHost, protocol);
    return `${protocol}://${host}`;
  }

  const root = getRootSiteUrl();
  const sub = (input.subdomain || "").trim().toLowerCase();
  if (input.isPrimary || sub === "main" || !sub) {
    return root;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${sub}.${splitHostAndPort(process.env.NEXT_PUBLIC_ROOT_DOMAIN).host}`;
  }

  const rootDomainRaw = rootDomainFromEnv() || "localhost";
  const rootDomainHost = splitHostAndPort(rootDomainRaw).host;
  const protocol: "http" | "https" = isLocalHostLike(rootDomainRaw)
    ? "http"
    : "https";
  const host = withLocalPortIfNeeded(`${sub}.${rootDomainHost}`, protocol);
  return `${protocol}://${host}`;
}

export function getSitePublicHost(input: {
  subdomain?: string | null;
  customDomain?: string | null;
  isPrimary?: boolean;
}) {
  const url = getSitePublicUrl(input);
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}
