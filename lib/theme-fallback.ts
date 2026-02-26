import { pluralizeLabel } from "@/lib/data-domain-labels";

export function uniqueCandidates(candidates: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const value = (item || "").trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function homeTemplateCandidates(configured?: string) {
  return uniqueCandidates([
    configured,
    "home.html",
    "index.html",
  ]);
}

export function domainDetailTemplateCandidates(dataDomain: string, slug: string) {
  const key = dataDomain.trim().toLowerCase();
  const plural = pluralizeLabel(key).trim().toLowerCase();
  const safeSlug = slug.trim().toLowerCase();
  return uniqueCandidates([
    safeSlug ? `single-${plural}-${safeSlug}.html` : "",
    safeSlug ? `single-${key}-${safeSlug}.html` : "",
    `single-${plural}.html`,
    `single-${key}.html`,
    safeSlug ? `${plural}-${safeSlug}.html` : "",
    safeSlug ? `${key}-${safeSlug}.html` : "",
    "single.html",
    "index.html",
  ]);
}

export function domainArchiveTemplateCandidates(domainKey: string, domainPluralSegment: string) {
  const key = domainKey.trim().toLowerCase();
  const plural = (domainPluralSegment || pluralizeLabel(key)).trim().toLowerCase();
  return uniqueCandidates([
    `archive-${plural}.html`,
    `archive-${key}.html`,
    "archive.html",
    `${plural}.html`,
    `${key}.html`,
    "index.html",
  ]);
}

export function taxonomyArchiveTemplateCandidates(taxonomy: "category" | "tag", slug: string) {
  const safeSlug = slug.trim().toLowerCase();
  return uniqueCandidates([
    `taxonomy-${taxonomy}-${safeSlug}.html`,
    `taxonomy-${taxonomy}.html`,
    `tax_${safeSlug}.html`,
    `tax_${taxonomy}_${safeSlug}.html`,
    `${taxonomy}-${safeSlug}.html`,
    `${taxonomy}.html`,
    "taxonomy.html",
    "archive.html",
    "index.html",
  ]);
}

export function notFoundTemplateCandidates() {
  return ["404.html", "index.html"];
}
