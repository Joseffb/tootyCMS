import { getSiteData } from "@/lib/fetchers";

function normalizeHost(raw: string) {
  return raw.trim().toLowerCase().replace(/:\d+$/, "");
}

function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

type HeaderReader = {
  get: (name: string) => string | null;
};

export async function resolveAnalyticsSiteId(input: {
  headers: HeaderReader;
  domainHint?: string | null;
}) {
  const domainHint = normalizeHost(String(input.domainHint || ""));
  if (domainHint && domainHint !== "all" && domainHint !== "nevergonnahappen") {
    const hintedSite = await getSiteData(domainHint);
    if (hintedSite?.id) return String(hintedSite.id);
  }

  const forwardedHost = firstHeaderValue(input.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(input.headers.get("host"));
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return undefined;

  const site = await getSiteData(normalizedHost);
  return site?.id ? String(site.id) : undefined;
}

