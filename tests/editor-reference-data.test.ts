import { describe, expect, it } from "vitest";

import {
  normalizeEditorReferenceData,
  shouldAllowManualEditorTaxonomyExpansion,
} from "@/lib/editor-reference-data";

describe("editor reference data", () => {
  it("synthesizes empty eager taxonomy arrays when category and tag exist in the overview", () => {
    const normalized = normalizeEditorReferenceData({
      taxonomyOverviewRows: [
        { taxonomy: "category", label: "Category", termCount: 1 },
        { taxonomy: "tag", label: "Tags", termCount: 0 },
      ],
      taxonomyTermsByKey: {},
      metaKeySuggestions: [],
    });

    expect(normalized.taxonomyTermsByKey).toEqual({
      category: [],
      tag: [],
    });
  });

  it("preserves explicit eager taxonomy arrays from the server payload", () => {
    const normalized = normalizeEditorReferenceData({
      taxonomyOverviewRows: [
        { taxonomy: "category", label: "Category", termCount: 1 },
        { taxonomy: "tag", label: "Tags", termCount: 1 },
      ],
      taxonomyTermsByKey: {
        category: [{ id: 1, name: "General" }],
        tag: [],
      },
      metaKeySuggestions: [],
    });

    expect(normalized.taxonomyTermsByKey).toEqual({
      category: [{ id: 1, name: "General" }],
      tag: [],
    });
  });

  it("does not allow client-side manual expansion for eager editorial taxonomies", () => {
    expect(
      shouldAllowManualEditorTaxonomyExpansion({
        taxonomy: "category",
        termCount: 42,
        loadedTermsCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldAllowManualEditorTaxonomyExpansion({
        taxonomy: "tag",
        termCount: 42,
        loadedTermsCount: 0,
      }),
    ).toBe(false);
  });

  it("allows manual expansion only for non-eager taxonomies when additional rows exist", () => {
    expect(
      shouldAllowManualEditorTaxonomyExpansion({
        taxonomy: "series",
        termCount: 10,
        loadedTermsCount: 4,
      }),
    ).toBe(true);

    expect(
      shouldAllowManualEditorTaxonomyExpansion({
        taxonomy: "series",
        termCount: 4,
        loadedTermsCount: 4,
      }),
    ).toBe(false);
  });
});
