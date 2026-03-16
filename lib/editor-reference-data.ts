export type EditorReferenceTaxonomyRow = {
  taxonomy: string;
  label: string;
  termCount: number;
};

export type EditorReferenceTaxonomyTerm = {
  id: number;
  name: string;
};

export type EditorReferenceData = {
  taxonomyOverviewRows: EditorReferenceTaxonomyRow[];
  taxonomyTermsByKey: Record<string, EditorReferenceTaxonomyTerm[]>;
  metaKeySuggestions: string[];
};

export const DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS: EditorReferenceTaxonomyRow[] = [
  { taxonomy: "category", label: "Category", termCount: 0 },
  { taxonomy: "tag", label: "Tags", termCount: 0 },
];

export const DEFAULT_EDITOR_REFERENCE_DATA: EditorReferenceData = {
  taxonomyOverviewRows: DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS,
  taxonomyTermsByKey: {},
  metaKeySuggestions: [],
};

export function isEagerEditorTaxonomy(taxonomy: string) {
  return taxonomy === "category" || taxonomy === "tag";
}

export function shouldAllowManualEditorTaxonomyExpansion(input: {
  taxonomy: string;
  termCount: number;
  loadedTermsCount: number;
}) {
  const taxonomy = String(input.taxonomy || "").trim();
  if (!taxonomy) return false;
  if (isEagerEditorTaxonomy(taxonomy)) return false;
  const termCount = Number.isFinite(Number(input.termCount)) ? Number(input.termCount) : 0;
  const loadedTermsCount = Number.isFinite(Number(input.loadedTermsCount))
    ? Number(input.loadedTermsCount)
    : 0;
  return termCount > loadedTermsCount;
}

export function normalizeEditorReferenceData(
  input: Partial<EditorReferenceData> | null | undefined,
): EditorReferenceData {
  const overviewSource = Array.isArray(input?.taxonomyOverviewRows)
    ? input.taxonomyOverviewRows
    : DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS;
  const taxonomyOverviewRows = overviewSource
    .map((row) => ({
      taxonomy: String(row?.taxonomy || "").trim(),
      label: String(row?.label || "").trim() || String(row?.taxonomy || "").trim(),
      termCount: Number.isFinite(Number(row?.termCount)) ? Number(row?.termCount) : 0,
    }))
    .filter((row) => row.taxonomy);

  const taxonomyTermsByKey = Object.fromEntries(
    Object.entries(input?.taxonomyTermsByKey || {}).map(([taxonomy, rows]) => [
      String(taxonomy || "").trim(),
      Array.isArray(rows)
        ? rows
            .map((row) => ({
              id: Number(row?.id),
              name: String(row?.name || "").trim(),
            }))
            .filter((row) => Number.isFinite(row.id) && row.name)
        : [],
    ]),
  );

  for (const row of taxonomyOverviewRows) {
    if (!isEagerEditorTaxonomy(row.taxonomy)) continue;
    if (Object.prototype.hasOwnProperty.call(taxonomyTermsByKey, row.taxonomy)) continue;
    taxonomyTermsByKey[row.taxonomy] = [];
  }

  const metaKeySuggestions = Array.isArray(input?.metaKeySuggestions)
    ? input.metaKeySuggestions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  return {
    taxonomyOverviewRows:
      taxonomyOverviewRows.length > 0 ? taxonomyOverviewRows : DEFAULT_EDITOR_TAXONOMY_OVERVIEW_ROWS,
    taxonomyTermsByKey,
    metaKeySuggestions,
  };
}
