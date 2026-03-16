import { describe, expect, it } from "vitest";

import {
  getDomainPostEditorAutosavePath,
  resolveDomainPostEditorAutosavePath,
} from "@/lib/editor-autosave-route";

describe("domain post editor autosave route", () => {
  it("builds the canonical autosave endpoint from the post id", () => {
    expect(getDomainPostEditorAutosavePath("post-123")).toBe(
      "/api/editor/domain-posts/post-123/autosave",
    );
  });

  it("prefers an explicit autosave endpoint when one is provided", () => {
    expect(resolveDomainPostEditorAutosavePath("post-123", "/custom/autosave")).toBe(
      "/custom/autosave",
    );
  });

  it("falls back to the canonical autosave endpoint when the explicit path is blank", () => {
    expect(resolveDomainPostEditorAutosavePath("post-123", "   ")).toBe(
      "/api/editor/domain-posts/post-123/autosave",
    );
  });

  it("returns null when no explicit endpoint or post id is available", () => {
    expect(resolveDomainPostEditorAutosavePath("", null)).toBeNull();
  });
});
