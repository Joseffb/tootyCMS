import { normalizeDomainSegment } from "@/lib/data-domain-routing";
import { pluralizeLabel } from "@/lib/data-domain-labels";

type Mode = "default" | "custom";

export type SitePermalinkSettings = {
  permalinkMode: Mode;
  singlePattern: string;
  listPattern: string;
  noDomainPrefix: string;
  noDomainDataDomain: string;
};

function cleanSegment(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-/_%]+/g, "");
}

function normalizePattern(raw: string, fallback: string) {
  const cleaned = raw.trim();
  if (!cleaned) return fallback;
  const normalized = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return normalized.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function applyTokens(pattern: string, data: { domain: string; domainPlural: string; slug: string }) {
  return pattern
    .replace(/%domain_plural%/g, data.domainPlural)
    .replace(/%domain%/g, data.domain)
    .replace(/%slug%/g, data.slug);
}

export function domainPluralSegment(domainKey: string) {
  return normalizeDomainSegment(pluralizeLabel(domainKey));
}

export function resolveNoDomainPrefixDomain(segment: string, settings: SitePermalinkSettings) {
  if (settings.permalinkMode !== "custom") return null;
  const prefix = cleanSegment(settings.noDomainPrefix);
  if (!prefix) return null;
  if (cleanSegment(segment) !== prefix) return null;
  return cleanSegment(settings.noDomainDataDomain || "post");
}

export function buildArchivePath(domainKey: string, settings: SitePermalinkSettings) {
  const domain = cleanSegment(domainKey);
  const domainPlural = domainPluralSegment(domain);

  if (settings.permalinkMode === "custom") {
    const mappedDomain = cleanSegment(settings.noDomainDataDomain || "post");
    const prefix = cleanSegment(settings.noDomainPrefix);
    if (prefix && mappedDomain === domain) {
      return `/${prefix}`;
    }
    const pattern = normalizePattern(settings.listPattern, "/%domain_plural%");
    return applyTokens(pattern, { domain, domainPlural, slug: "" }).replace(/\/+$/, "") || "/";
  }

  return `/${domainPlural}`;
}

export function buildDetailPath(domainKey: string, slug: string, settings: SitePermalinkSettings) {
  const domain = cleanSegment(domainKey);
  const safeSlug = cleanSegment(slug);
  const domainPlural = domainPluralSegment(domain);

  if (settings.permalinkMode === "custom") {
    const mappedDomain = cleanSegment(settings.noDomainDataDomain || "post");
    const prefix = cleanSegment(settings.noDomainPrefix);
    if (prefix && mappedDomain === domain) {
      return `/${prefix}/${safeSlug}`;
    }
    const pattern = normalizePattern(settings.singlePattern, "/%domain%/%slug%");
    return applyTokens(pattern, { domain, domainPlural, slug: safeSlug });
  }

  return `/${domain}/${safeSlug}`;
}
