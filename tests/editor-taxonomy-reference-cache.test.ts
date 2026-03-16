import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearEditorTaxonomyReferenceCache,
  primeEditorTaxonomyReferenceCache,
  readEditorTaxonomyReferenceCache,
  runWithEditorTaxonomyReferenceCache,
} from "@/lib/editor-taxonomy-reference-cache";

describe("editor taxonomy reference cache", () => {
  afterEach(() => {
    clearEditorTaxonomyReferenceCache();
    vi.restoreAllMocks();
  });

  it("reuses loaded empty taxonomy rows across editor instances", () => {
    primeEditorTaxonomyReferenceCache({
      siteId: "site-1",
      taxonomyTermsByKey: {
        category: [],
        tag: [],
      },
    });

    expect(readEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "category" })).toEqual([]);
    expect(readEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "tag" })).toEqual([]);
  });

  it("treats cached empty taxonomy rows as a real cache hit and skips the loader", async () => {
    primeEditorTaxonomyReferenceCache({
      siteId: "site-1",
      taxonomyTermsByKey: {
        tag: [],
      },
    });

    const loader = vi.fn(async () => [{ id: 99, name: "Should not run" }]);
    const rows = await runWithEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "tag" }, loader);

    expect(loader).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("deduplicates in-flight taxonomy loads for the same site and taxonomy", async () => {
    const loader = vi.fn(async () => [{ id: 1, name: "General" }]);

    const [first, second] = await Promise.all([
      runWithEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "category" }, loader),
      runWithEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "category" }, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual([{ id: 1, name: "General" }]);
    expect(second).toEqual([{ id: 1, name: "General" }]);
    expect(readEditorTaxonomyReferenceCache({ siteId: "site-1", taxonomy: "category" })).toEqual([
      { id: 1, name: "General" },
    ]);
  });
});
