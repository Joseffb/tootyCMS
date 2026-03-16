import {
  isEagerEditorTaxonomy,
  type EditorReferenceTaxonomyRow,
  type EditorReferenceTaxonomyTerm,
} from "@/lib/editor-reference-data";

export type EditorTaxonomyLoadStatus = "idle" | "loading" | "loaded" | "error";
export type EditorTaxonomyAutoloadStatus = "pending" | "settled";
export type EditorAutoloadContext = "persisted-item" | "draft-shell";

export const EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS = 1;
export const EDITOR_TAXONOMY_CONSISTENCY_RETRY_ATTEMPTS = 6;

export function buildEditorTaxonomyLoadState(
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[],
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>,
): Record<string, EditorTaxonomyLoadStatus> {
  const next: Record<string, EditorTaxonomyLoadStatus> = {};
  for (const row of taxonomyOverviewRows) {
    const taxonomy = String(row?.taxonomy || "").trim();
    if (!taxonomy) continue;
    next[taxonomy] = Object.prototype.hasOwnProperty.call(taxonomyTermsByKey, taxonomy) ? "loaded" : "idle";
  }
  return next;
}

export function buildEditorTaxonomyAutoloadState(
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[],
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>,
): Record<string, EditorTaxonomyAutoloadStatus> {
  const next: Record<string, EditorTaxonomyAutoloadStatus> = {};
  for (const row of taxonomyOverviewRows) {
    const taxonomy = String(row?.taxonomy || "").trim();
    if (!taxonomy || !isEagerEditorTaxonomy(taxonomy)) continue;
    next[taxonomy] = Object.prototype.hasOwnProperty.call(taxonomyTermsByKey, taxonomy) ? "settled" : "pending";
  }
  return next;
}

export function hasSeededEditorTaxonomyReferenceData(
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[],
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>,
) {
  const eagerTaxonomies = taxonomyOverviewRows
    .map((row) => String(row?.taxonomy || "").trim())
    .filter((taxonomy) => taxonomy && isEagerEditorTaxonomy(taxonomy))
    .filter((taxonomy, index, rows) => rows.indexOf(taxonomy) === index);

  if (eagerTaxonomies.length === 0) return false;

  return eagerTaxonomies.every((taxonomy) =>
    Object.prototype.hasOwnProperty.call(taxonomyTermsByKey, taxonomy),
  );
}

export function getEditorTaxonomiesNeedingAutoload(
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[],
  taxonomyLoadStateByKey: Record<string, EditorTaxonomyLoadStatus>,
  taxonomyAutoloadStateByKey: Record<string, EditorTaxonomyAutoloadStatus>,
  selectedTermsByTaxonomy: Record<string, number[]>,
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>,
  termNameById: Record<number, string>,
  editorAutoloadContext: EditorAutoloadContext = "draft-shell",
): string[] {
  if (editorAutoloadContext === "persisted-item") {
    return [];
  }

  return taxonomyOverviewRows
    .map((row) => String(row?.taxonomy || "").trim())
    .filter((taxonomy) => taxonomy && isEagerEditorTaxonomy(taxonomy))
    .filter((taxonomy, index, rows) => rows.indexOf(taxonomy) === index)
    .filter((taxonomy) => (taxonomyAutoloadStateByKey[taxonomy] ?? "pending") === "pending")
    .filter((taxonomy) => (taxonomyLoadStateByKey[taxonomy] ?? "idle") === "idle")
    .filter((taxonomy) =>
      hasUnresolvedSelectedTermsForEditorTaxonomy({
        taxonomy,
        selectedTermsByTaxonomy,
        taxonomyTermsByKey,
        termNameById,
      }),
    );
}

export function hasUnresolvedSelectedTermsForEditorTaxonomy(input: {
  taxonomy: string;
  selectedTermsByTaxonomy: Record<string, number[]>;
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>;
  termNameById: Record<number, string>;
}) {
  const taxonomy = String(input.taxonomy || "").trim();
  if (!taxonomy) return false;

  const selectedTermIds = Array.isArray(input.selectedTermsByTaxonomy[taxonomy])
    ? input.selectedTermsByTaxonomy[taxonomy]
    : [];
  if (selectedTermIds.length === 0) return false;

  const loadedTermIdSet = new Set((input.taxonomyTermsByKey[taxonomy] ?? []).map((term) => term.id));
  return selectedTermIds.some((id) => {
    if (!Number.isFinite(id)) return false;
    if (loadedTermIdSet.has(id)) return false;
    return !String(input.termNameById[id] || "").trim();
  });
}

export function resolveEditorTaxonomyRetryAttempts(input: {
  taxonomy: string;
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[];
  selectedTermsByTaxonomy?: Record<string, number[]>;
  pendingWritesByTaxonomy?: Record<string, number>;
}) {
  const taxonomy = String(input.taxonomy || "").trim();
  if (!taxonomy || !isEagerEditorTaxonomy(taxonomy)) {
    return EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS;
  }

  const selectedCount = Array.isArray(input.selectedTermsByTaxonomy?.[taxonomy])
    ? input.selectedTermsByTaxonomy![taxonomy]!.length
    : 0;
  const pendingWriteCount = Number(input.pendingWritesByTaxonomy?.[taxonomy] ?? 0);
  // Empty eager taxonomies are a valid loaded state on persisted article/item pages.
  // We only retry empty results when the current article/editor state suggests terms
  // should already exist on the current article or a write is still converging.
  if (selectedCount > 0 || pendingWriteCount > 0) {
    return EDITOR_TAXONOMY_CONSISTENCY_RETRY_ATTEMPTS;
  }

  return EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS;
}

export function shouldFetchEditorTaxonomyTermsFromNetwork(input: {
  taxonomy: string;
  hasSeededRows?: boolean;
}) {
  const taxonomy = String(input.taxonomy || "").trim();
  if (!taxonomy) return false;

  // Article/item pages already receive category/tag terms from the server-seeded
  // editor reference payload. Client-side eager taxonomy fetches should therefore
  // fail closed to a local/cache-only path, even if a stale UI event asks again.
  if (isEagerEditorTaxonomy(taxonomy)) {
    return false;
  }

  return true;
}
