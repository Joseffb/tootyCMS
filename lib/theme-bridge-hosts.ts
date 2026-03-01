function normalizeHost(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function splitHostAndPort(value: string) {
  const normalized = normalizeHost(value);
  const match = normalized.match(/^(.*?):(\d+)$/);
  if (!match) return { host: normalized, port: "" };
  return {
    host: match[1] || "",
    port: match[2] || "",
  };
}

function buildOrigin(protocol: string, host: string, port = "") {
  const normalizedProtocol = protocol || "http:";
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return "";
  const hostPart = port ? `${normalizedHost}:${port}` : normalizedHost;
  return `${normalizedProtocol}//${hostPart}`;
}

export function isAllowedThemeBridgeHostname(hostname: string) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  if (!normalizedHostname) return false;
  if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) {
    return true;
  }

  const configured = splitHostAndPort(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "");
  if (!configured.host) return false;
  return (
    normalizedHostname === configured.host ||
    normalizedHostname.endsWith(`.${configured.host}`)
  );
}

export function isAllowedThemeBridgeOrigin(rawOrigin: string) {
  const value = String(rawOrigin || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return isAllowedThemeBridgeHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedThemeBridgeReturnUrl(rawValue: string) {
  const value = String(rawValue || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return isAllowedThemeBridgeHostname(url.hostname);
  } catch {
    return false;
  }
}

export function deriveThemeBridgeAdminBaseFromReturnUrl(returnUrl: string, fallbackOrigin: string, adminPathAlias: string) {
  try {
    const target = new URL(returnUrl);
    const configured = splitHostAndPort(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "");
    const host = configured.host || target.hostname;
    const port = configured.port || target.port || "";
    return `${buildOrigin(target.protocol, host, port)}/app/${adminPathAlias}`;
  } catch {
    // fall through
  }

  try {
    const fallback = new URL(fallbackOrigin);
    const configured = splitHostAndPort(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "");
    const host = configured.host || fallback.hostname;
    const port = configured.port || fallback.port || "";
    return `${buildOrigin(fallback.protocol, host, port)}/app/${adminPathAlias}`;
  } catch {
    return `/app/${adminPathAlias}`;
  }
}
