import type { EditorReferenceTaxonomyTerm } from "@/lib/editor-reference-data";

type EditorTaxonomyReferenceCacheInput = {
  siteId: string;
  taxonomy: string;
  limit?: number;
};

type EditorTaxonomyReferenceCacheEntry = {
  loadedAt: number;
  rows: EditorReferenceTaxonomyTerm[];
};

const EDITOR_TAXONOMY_REFERENCE_CACHE_TTL_MS = 5 * 60 * 1000;

const taxonomyReferenceCache = new Map<string, EditorTaxonomyReferenceCacheEntry>();
const taxonomyReferenceInFlight = new Map<string, Promise<EditorReferenceTaxonomyTerm[]>>();

function buildEditorTaxonomyReferenceCacheKey(input: EditorTaxonomyReferenceCacheInput) {
  const siteId = String(input.siteId || "").trim();
  const taxonomy = String(input.taxonomy || "").trim();
  const limitSegment =
    Number.isFinite(Number(input.limit)) && Number(input.limit) > 0 ? String(Number(input.limit)) : "all";
  return `${siteId}::${taxonomy}::${limitSegment}`;
}

export function readEditorTaxonomyReferenceCache(
  input: EditorTaxonomyReferenceCacheInput,
): EditorReferenceTaxonomyTerm[] | null {
  const cacheKey = buildEditorTaxonomyReferenceCacheKey(input);
  const entry = taxonomyReferenceCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > EDITOR_TAXONOMY_REFERENCE_CACHE_TTL_MS) {
    taxonomyReferenceCache.delete(cacheKey);
    taxonomyReferenceInFlight.delete(cacheKey);
    return null;
  }
  return entry.rows;
}

export function writeEditorTaxonomyReferenceCache(
  input: EditorTaxonomyReferenceCacheInput,
  rows: EditorReferenceTaxonomyTerm[],
) {
  const cacheKey = buildEditorTaxonomyReferenceCacheKey(input);
  taxonomyReferenceCache.set(cacheKey, {
    loadedAt: Date.now(),
    rows,
  });
}

export function primeEditorTaxonomyReferenceCache(input: {
  siteId: string;
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>;
}) {
  const siteId = String(input.siteId || "").trim();
  if (!siteId) return;
  for (const [taxonomy, rows] of Object.entries(input.taxonomyTermsByKey || {})) {
    const normalizedTaxonomy = String(taxonomy || "").trim();
    if (!normalizedTaxonomy) continue;
    writeEditorTaxonomyReferenceCache(
      {
        siteId,
        taxonomy: normalizedTaxonomy,
      },
      Array.isArray(rows) ? rows : [],
    );
  }
}

export function getEditorTaxonomyReferenceInFlight(
  input: EditorTaxonomyReferenceCacheInput,
): Promise<EditorReferenceTaxonomyTerm[]> | null {
  return taxonomyReferenceInFlight.get(buildEditorTaxonomyReferenceCacheKey(input)) ?? null;
}

export function runWithEditorTaxonomyReferenceCache(
  input: EditorTaxonomyReferenceCacheInput,
  loader: () => Promise<EditorReferenceTaxonomyTerm[]>,
) {
  const cachedRows = readEditorTaxonomyReferenceCache(input);
  if (cachedRows !== null) {
    return Promise.resolve(cachedRows);
  }

  const cacheKey = buildEditorTaxonomyReferenceCacheKey(input);
  const existingRequest = taxonomyReferenceInFlight.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = loader()
    .then((rows) => {
      writeEditorTaxonomyReferenceCache(input, rows);
      return rows;
    })
    .finally(() => {
      taxonomyReferenceInFlight.delete(cacheKey);
    });

  taxonomyReferenceInFlight.set(cacheKey, request);
  return request;
}

export function clearEditorTaxonomyReferenceCache() {
  taxonomyReferenceCache.clear();
  taxonomyReferenceInFlight.clear();
}
