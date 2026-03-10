import { describe, expect, it } from "vitest";

import {
  filterVisibleEditorMetaEntries,
  isEditorVisibleMetaKey,
  updateEditorMetaEntryValue,
  upsertEditorMetaEntry,
} from "@/lib/editor-meta";

describe("editor meta helpers", () => {
  it("hides underscore-prefixed meta keys from the editor list", () => {
    expect(isEditorVisibleMetaKey("_view_count")).toBe(false);
    expect(isEditorVisibleMetaKey("view_count")).toBe(false);
    expect(
      filterVisibleEditorMetaEntries([
        { key: "_view_count", value: "9" },
        { key: "view_count", value: "12" },
        { key: "subtitle", value: "Hello" },
      ]),
    ).toEqual([{ key: "subtitle", value: "Hello" }]);
  });

  it("upserts meta entries by key case-insensitively", () => {
    expect(
      upsertEditorMetaEntry([{ key: "subtitle", value: "Old" }], "Subtitle", "New"),
    ).toEqual([{ key: "Subtitle", value: "New" }]);
  });

  it("updates visible meta values inline without changing other entries", () => {
    expect(
      updateEditorMetaEntryValue(
        [
          { key: "subtitle", value: "Old" },
          { key: "_view_count", value: "9" },
        ],
        "subtitle",
        "New",
      ),
    ).toEqual([
      { key: "subtitle", value: "New" },
      { key: "_view_count", value: "9" },
    ]);
  });
});
