function resolveLocalPort() {
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

export function getRootSiteUrl() {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }

  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (rootDomain) {
    if (/:\d+$/.test(rootDomain)) {
      return `http://${rootDomain}`;
    }
    return `http://${rootDomain}:${resolveLocalPort()}`;
  }

  return `http://localhost:${resolveLocalPort()}`;
}

export function withLocalDevPort(url: string) {
  const trimmed = url.trim();
  if (!trimmed || process.env.NEXT_PUBLIC_VERCEL_ENV) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.port) return `${parsed.protocol}//${parsed.host}`;
    const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "").trim().replace(/:\d+$/, "").toLowerCase();
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
    return `https://${input.customDomain}`;
  }

  const root = getRootSiteUrl();
  const sub = (input.subdomain || "").trim().toLowerCase();
  if (input.isPrimary || sub === "main" || !sub) {
    return root;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${sub}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }

  const rootDomainRaw = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").trim().replace(/^https?:\/\//, "");
  const rootDomainHost = rootDomainRaw.replace(/:\d+$/, "");
  return `http://${sub}.${rootDomainHost}:${resolveLocalPort()}`;
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
