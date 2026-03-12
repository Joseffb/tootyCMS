const PG_IDENTIFIER_MAX_LENGTH = 63;

function normalizeToken(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function siteIdentityToken(siteId: string) {
  const normalizedSiteId = normalizeToken(siteId);
  if (!normalizedSiteId) {
    throw new Error("siteId is required.");
  }
  return normalizedSiteId;
}

export function sitePhysicalTableName(prefix: string, siteId: string, suffix: string) {
  const normalizedPrefix = String(prefix || "").trim();
  const normalizedSiteId = siteIdentityToken(siteId);
  const normalizedSuffix = normalizeToken(suffix);
  if (!normalizedSuffix) {
    throw new Error("suffix is required.");
  }

  const readable = `${normalizedPrefix}site_${normalizedSiteId}_${normalizedSuffix}`;
  if (readable.length <= PG_IDENTIFIER_MAX_LENGTH) {
    return readable;
  }

  const hash = stableHash(normalizedSiteId);
  const reservedLength = normalizedPrefix.length + "site_".length + normalizedSuffix.length + hash.length + 2;
  if (reservedLength >= PG_IDENTIFIER_MAX_LENGTH) {
    throw new Error(`Cannot build site table name for suffix "${normalizedSuffix}".`);
  }
  const maxTokenLength = PG_IDENTIFIER_MAX_LENGTH - reservedLength;
  const compactToken = normalizedSiteId.slice(0, maxTokenLength);

  return `${normalizedPrefix}site_${compactToken}_${hash}_${normalizedSuffix}`;
}

export function sitePhysicalSequenceName(prefix: string, siteId: string, suffix: string) {
  return sitePhysicalTableName(prefix, siteId, suffix);
}

export function physicalObjectName(baseName: string, suffix: string) {
  const normalizedBaseName = normalizeToken(baseName);
  const normalizedSuffix = normalizeToken(suffix);
  if (!normalizedBaseName) {
    throw new Error("baseName is required.");
  }
  if (!normalizedSuffix) {
    throw new Error("suffix is required.");
  }

  const readable = `${normalizedBaseName}_${normalizedSuffix}`;
  if (readable.length <= PG_IDENTIFIER_MAX_LENGTH) {
    return readable;
  }

  const hash = stableHash(`${normalizedBaseName}:${normalizedSuffix}`);
  const reservedLength = normalizedSuffix.length + hash.length + 2;
  if (reservedLength >= PG_IDENTIFIER_MAX_LENGTH) {
    throw new Error(`Cannot build physical object name for suffix "${normalizedSuffix}".`);
  }
  const maxBaseLength = PG_IDENTIFIER_MAX_LENGTH - reservedLength;
  const compactBaseName = normalizedBaseName.slice(0, maxBaseLength);
  return `${compactBaseName}_${hash}_${normalizedSuffix}`;
}

function stableHash(input: string) {
  // FNV-1a 64-bit hash encoded as fixed-width lowercase hex.
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const modulo = BigInt("0xffffffffffffffff");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & modulo;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}
