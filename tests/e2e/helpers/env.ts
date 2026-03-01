function normalizeHost(input: string) {
  return input.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function parseOrigin(input: string) {
  return new URL(input);
}

function buildOrigin(protocol: string, host: string, port?: string) {
  const normalizedHost = normalizeHost(host).replace(/:\d+$/, "");
  const finalHost = port ? `${normalizedHost}:${port}` : normalizedHost;
  return `${protocol}//${finalHost}`;
}

function adminAlias() {
  const raw = String(process.env.ADMIN_PATH || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return raw || "cp";
}

function buildPublicOriginFromEnv() {
  const app = parseOrigin(getAppOrigin());
  const rootDomain = normalizeHost(String(process.env.NEXT_PUBLIC_ROOT_DOMAIN || ""));
  if (!rootDomain) {
    return `${app.protocol}//localhost:${app.port || "3000"}`;
  }

  const rootHasPort = /:\d+$/.test(rootDomain);
  const host = rootHasPort || !app.port ? rootDomain : `${rootDomain}:${app.port}`;
  return `${app.protocol}//${host}`;
}

export function getAppOrigin() {
  const explicit = String(process.env.E2E_APP_ORIGIN || "").trim();
  if (explicit) return explicit;
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
}

export function getAdminBaseUrl() {
  return `${getAppOrigin()}/app/${adminAlias()}`;
}

export function getAppHost() {
  return parseOrigin(getAppOrigin()).host;
}

export function getAppHostname() {
  return parseOrigin(getAppOrigin()).hostname;
}

export function getPublicOrigin() {
  return String(process.env.E2E_PUBLIC_ORIGIN || buildPublicOriginFromEnv()).trim();
}

export function getPublicHost() {
  return parseOrigin(getPublicOrigin()).host;
}

export function getPublicHostname() {
  return parseOrigin(getPublicOrigin()).hostname;
}

export function getOriginForHost(host: string) {
  const base = parseOrigin(getPublicOrigin());
  return buildOrigin(base.protocol, host, base.port || undefined);
}

export function buildPublicOriginForSubdomain(subdomain: string) {
  const base = parseOrigin(getPublicOrigin());
  const root = getPublicHostname();
  const trimmedSubdomain = subdomain.trim().replace(/\.+$/, "").replace(/^\.+/, "");
  return buildOrigin(base.protocol, `${trimmedSubdomain}.${root}`, base.port || undefined);
}
