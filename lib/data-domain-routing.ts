import { pluralizeLabel, singularizeLabel } from "@/lib/data-domain-labels";

export function normalizeDomainSegment(segment: string) {
  return segment.trim().toLowerCase();
}

export function normalizeDomainKeyFromSegment(segment: string) {
  return singularizeLabel(normalizeDomainSegment(segment));
}

export function isDomainArchiveSegment(inputSegment: string, domainKey: string, domainLabel: string) {
  const segment = normalizeDomainSegment(inputSegment);
  const key = normalizeDomainSegment(domainKey);
  const pluralFromLabel = normalizeDomainSegment(pluralizeLabel(domainLabel));
  const pluralFromKey = normalizeDomainSegment(pluralizeLabel(key));
  return segment === pluralFromLabel || segment === pluralFromKey;
}
