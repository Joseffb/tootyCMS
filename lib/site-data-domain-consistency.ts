import { DEFAULT_CORE_DOMAIN_KEYS, ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import { findSiteDataDomainByKey } from "@/lib/site-data-domain-registry";

const CORE_DOMAIN_LOOKUP_ATTEMPTS = 12;
const CORE_DOMAIN_LOOKUP_BASE_DELAY_MS = 150;

function normalizeScope(value: string) {
  return String(value || "").trim();
}

function normalizeDomainKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isCoreDomainKey(domainKey: string) {
  return DEFAULT_CORE_DOMAIN_KEYS.includes(domainKey as (typeof DEFAULT_CORE_DOMAIN_KEYS)[number]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findSiteDataDomainByKeyWithConsistency(siteId: string, domainKey: string) {
  const normalizedSiteId = normalizeScope(siteId);
  const normalizedDomainKey = normalizeDomainKey(domainKey);

  if (!normalizedSiteId || !normalizedDomainKey) {
    return null;
  }

  await ensureDefaultCoreDataDomains(normalizedSiteId);

  const attempts = isCoreDomainKey(normalizedDomainKey) ? CORE_DOMAIN_LOOKUP_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const row = await findSiteDataDomainByKey(normalizedSiteId, normalizedDomainKey);
    if (row) {
      return row;
    }
    if (attempt < attempts) {
      await sleep(Math.min(CORE_DOMAIN_LOOKUP_BASE_DELAY_MS * attempt, 1_000));
    }
  }

  return null;
}

