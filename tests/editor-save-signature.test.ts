import { describe, expect, it } from "vitest";

import { buildEditorSaveSignature } from "@/lib/editor-save-signature";

describe("buildEditorSaveSignature", () => {
  it("produces the same signature shape used before and after save reconciliation", () => {
    const input = {
      id: "post-1",
      title: "Title",
      description: "Description",
      slug: "title",
      content: "{\"type\":\"doc\"}",
      published: false,
      password: "",
      usePassword: false,
      layout: null,
      selectedTermsByTaxonomy: { category: [1], tag: [2] },
      categoryIds: [1],
      tagIds: [2],
      taxonomyIds: [1, 2],
      metaEntries: [{ key: "_publish_at", value: "2026-03-12T12:00:00.000Z" }],
    };

    const signature = buildEditorSaveSignature(input);
    expect(signature).toContain("\"password\":\"\"");
    expect(signature).not.toContain("postPassword");
    expect(signature).toBe(buildEditorSaveSignature({ ...input }));
  });
});
