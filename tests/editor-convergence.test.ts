import { describe, expect, it } from "vitest";

import { computeEditorConvergence } from "@/lib/editor-convergence";

describe("computeEditorConvergence", () => {
  it("does not preserve local state when persisted item signatures already match", () => {
    const signature = JSON.stringify({
      id: "post-1",
      title: "Title",
      description: "",
      slug: "title",
      content: "{\"type\":\"doc\",\"content\":[]}",
      published: false,
      password: "",
      usePassword: false,
      layout: null,
      selectedTermsByTaxonomy: { category: [], tag: [] },
      categoryIds: [],
      tagIds: [],
      taxonomyIds: [],
      metaEntries: [],
    });

    const result = computeEditorConvergence({
      currentClientSignature: signature,
      lastQueuedSignature: signature,
      lastSavedSignature: signature,
      incomingSignature: signature,
      samePost: true,
      lastLocalMutationAt: 0,
      lastRecoveredCacheAt: 0,
      shouldUseCachedEditorState: false,
      now: Date.now(),
    });

    expect(result.hasUnsavedLocalState).toBe(false);
    expect(result.shouldPreserveLocalState).toBe(false);
    expect(result.preserveLocalDraft).toBe(false);
    expect(result.preserveRecentLocalDraft).toBe(false);
    expect(result.preserveStaleIncomingPost).toBe(false);
  });
});
