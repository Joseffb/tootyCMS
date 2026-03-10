import { describe, expect, it } from "vitest";

import { MAX_SEO_SLUG_LENGTH, normalizeSeoSlug, normalizeSlugDraft } from "@/lib/slug";

describe("slug normalization", () => {
  it("preserves a trailing dash while the user is still typing", () => {
    expect(normalizeSlugDraft("Custom-")).toBe("custom-");
    expect(normalizeSlugDraft("custom-dashed-url")).toBe("custom-dashed-url");
  });

  it("removes a trailing dash when the slug is finalized", () => {
    expect(normalizeSeoSlug("Custom-")).toBe("custom");
    expect(normalizeSeoSlug("custom-dashed-url")).toBe("custom-dashed-url");
  });

  it("keeps the shared normalization rules aligned", () => {
    expect(normalizeSlugDraft("Crème & Story")).toBe("creme-and-story");
    expect(normalizeSeoSlug("Crème & Story")).toBe("creme-and-story");
  });

  it("caps draft slugs at the SEO length limit", () => {
    expect(normalizeSlugDraft(`custom-${"a".repeat(200)}`).length).toBe(MAX_SEO_SLUG_LENGTH);
    expect(normalizeSeoSlug(`custom-${"a".repeat(200)}`).length).toBe(MAX_SEO_SLUG_LENGTH);
  });
});
