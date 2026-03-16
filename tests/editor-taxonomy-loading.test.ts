import { describe, expect, it } from "vitest";

import {
  buildEditorTaxonomyAutoloadState,
  buildEditorTaxonomyLoadState,
  EDITOR_TAXONOMY_CONSISTENCY_RETRY_ATTEMPTS,
  EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS,
  getEditorTaxonomiesNeedingAutoload,
  hasUnresolvedSelectedTermsForEditorTaxonomy,
  hasSeededEditorTaxonomyReferenceData,
  resolveEditorTaxonomyRetryAttempts,
  shouldFetchEditorTaxonomyTermsFromNetwork,
} from "@/lib/editor-taxonomy-loading";

describe("editor taxonomy loading", () => {
  it("treats loaded empty eager taxonomy arrays as loaded instead of idle", () => {
    const state = buildEditorTaxonomyLoadState(
      [
        { taxonomy: "category", label: "Category", termCount: 0 },
        { taxonomy: "tag", label: "Tags", termCount: 0 },
      ],
      {
        category: [],
        tag: [],
      },
    );

    expect(state).toEqual({
      category: "loaded",
      tag: "loaded",
    });
  });

  it("settles eager autoload when the server already seeded category and tag arrays, even if empty", () => {
    const state = buildEditorTaxonomyAutoloadState(
      [
        { taxonomy: "category", label: "Category", termCount: 0 },
        { taxonomy: "tag", label: "Tags", termCount: 0 },
      ],
      {
        category: [],
        tag: [],
      },
    );

    expect(state).toEqual({
      category: "settled",
      tag: "settled",
    });
  });

  it("treats seeded eager taxonomy keys as authoritative even when the arrays are empty", () => {
    expect(
      hasSeededEditorTaxonomyReferenceData(
        [
          { taxonomy: "category", label: "Category", termCount: 0 },
          { taxonomy: "tag", label: "Tags", termCount: 0 },
        ],
        {
          category: [],
          tag: [],
        },
      ),
    ).toBe(true);

    expect(
      hasSeededEditorTaxonomyReferenceData(
        [
          { taxonomy: "category", label: "Category", termCount: 0 },
          { taxonomy: "tag", label: "Tags", termCount: 0 },
        ],
        {
          category: [],
        },
      ),
    ).toBe(false);
  });

  it("autoloads only eager taxonomies that are still pending and idle", () => {
    const taxonomies = getEditorTaxonomiesNeedingAutoload(
      [
        { taxonomy: "category", label: "Category", termCount: 0 },
        { taxonomy: "tag", label: "Tags", termCount: 0 },
        { taxonomy: "series", label: "Series", termCount: 0 },
      ],
      {
        category: "loaded",
        tag: "idle",
        series: "idle",
      },
      {
        category: "settled",
        tag: "pending",
      },
      {
        tag: [5],
      },
      {
        tag: [],
      },
      {},
      "draft-shell",
    );

    expect(taxonomies).toEqual(["tag"]);
  });

  it("does not autoload eager taxonomies when the current article has no unresolved selected terms", () => {
    const taxonomies = getEditorTaxonomiesNeedingAutoload(
      [
        { taxonomy: "category", label: "Category", termCount: 3 },
        { taxonomy: "tag", label: "Tags", termCount: 12 },
      ],
      {
        category: "idle",
        tag: "idle",
      },
      {
        category: "pending",
        tag: "pending",
      },
      {
        category: [],
        tag: [],
      },
      {
        category: [],
        tag: [],
      },
      {},
      "draft-shell",
    );

    expect(taxonomies).toEqual([]);
  });

  it("never autoloads eager taxonomies on persisted item editors", () => {
    const taxonomies = getEditorTaxonomiesNeedingAutoload(
      [
        { taxonomy: "category", label: "Category", termCount: 3 },
        { taxonomy: "tag", label: "Tags", termCount: 12 },
      ],
      {
        category: "idle",
        tag: "idle",
      },
      {
        category: "pending",
        tag: "pending",
      },
      {
        category: [3],
        tag: [7],
      },
      {
        category: [],
        tag: [],
      },
      {},
      "persisted-item",
    );

    expect(taxonomies).toEqual([]);
  });

  it("treats selected terms with known labels as resolved even when eager lists are empty", () => {
    expect(
      hasUnresolvedSelectedTermsForEditorTaxonomy({
        taxonomy: "tag",
        selectedTermsByTaxonomy: { tag: [7] },
        taxonomyTermsByKey: { tag: [] },
        termNameById: { 7: "Known Tag" },
      }),
    ).toBe(false);

    expect(
      hasUnresolvedSelectedTermsForEditorTaxonomy({
        taxonomy: "tag",
        selectedTermsByTaxonomy: { tag: [7] },
        taxonomyTermsByKey: { tag: [] },
        termNameById: {},
      }),
    ).toBe(true);
  });

  it("treats empty eager taxonomies as a terminal load when article state has no terms", () => {
    const attempts = resolveEditorTaxonomyRetryAttempts({
      taxonomy: "tag",
      taxonomyOverviewRows: [{ taxonomy: "tag", label: "Tags", termCount: 0 }],
      selectedTermsByTaxonomy: {},
      pendingWritesByTaxonomy: {},
    });

    expect(attempts).toBe(EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS);
  });

  it("keeps a small consistency retry budget when article state suggests terms should exist", () => {
    const attempts = resolveEditorTaxonomyRetryAttempts({
      taxonomy: "tag",
      taxonomyOverviewRows: [{ taxonomy: "tag", label: "Tags", termCount: 1 }],
      selectedTermsByTaxonomy: { tag: [5] },
      pendingWritesByTaxonomy: { tag: 1 },
    });

    expect(attempts).toBe(EDITOR_TAXONOMY_CONSISTENCY_RETRY_ATTEMPTS);
  });

  it("does not retry empty eager taxonomy loads only because the site has known terms", () => {
    const attempts = resolveEditorTaxonomyRetryAttempts({
      taxonomy: "tag",
      taxonomyOverviewRows: [{ taxonomy: "tag", label: "Tags", termCount: 42 }],
      selectedTermsByTaxonomy: {},
      pendingWritesByTaxonomy: {},
    });

    expect(attempts).toBe(EDITOR_TAXONOMY_EMPTY_RESULT_ATTEMPTS);
  });

  it("never performs client-side network fetches for eager category/tag references", () => {
    expect(shouldFetchEditorTaxonomyTermsFromNetwork({ taxonomy: "category" })).toBe(false);
    expect(shouldFetchEditorTaxonomyTermsFromNetwork({ taxonomy: "tag" })).toBe(false);
    expect(shouldFetchEditorTaxonomyTermsFromNetwork({ taxonomy: "series" })).toBe(true);
  });
});
