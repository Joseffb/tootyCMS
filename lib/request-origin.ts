function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

function normalizeHost(raw: string) {
  return raw.trim().toLowerCase();
}

export function deriveRequestOriginFromRequest(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = normalizeHost(forwardedHost || firstHeaderValue(request.headers.get("host")));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto || (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  if (host) {
    return `${protocol}://${host}`;
  }

  return new URL(request.url).origin;
}
