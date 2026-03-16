import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveAuthorizedSiteForAnyCapability: vi.fn(),
  getTaxonomyOverview: vi.fn(),
  getTaxonomyTerms: vi.fn(),
  getTaxonomyTermsPreview: vi.fn(),
  getAllMetaKeys: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/admin-site-selection", () => ({
  resolveAuthorizedSiteForAnyCapability: mocks.resolveAuthorizedSiteForAnyCapability,
}));

vi.mock("@/lib/actions", () => ({
  getTaxonomyOverview: mocks.getTaxonomyOverview,
  getTaxonomyTerms: mocks.getTaxonomyTerms,
  getTaxonomyTermsPreview: mocks.getTaxonomyTermsPreview,
  getAllMetaKeys: mocks.getAllMetaKeys,
}));

import { GET } from "@/app/api/editor/reference/route";

describe("/api/editor/reference", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns an initial editor reference snapshot for the authorized site", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resolveAuthorizedSiteForAnyCapability.mockResolvedValue({ site: { id: "site-1" } });
    mocks.getTaxonomyOverview.mockResolvedValue([
      { taxonomy: "category", label: "Category", termCount: 2 },
      { taxonomy: "tag", label: "Tags", termCount: 1 },
      { taxonomy: "series", label: "Series", termCount: 3 },
    ]);
    mocks.getTaxonomyTerms
      .mockResolvedValueOnce([{ id: 11, name: "General" }])
      .mockResolvedValueOnce([{ id: 22, name: "News" }]);
    mocks.getAllMetaKeys.mockResolvedValue(["seo_title", "_view_count"]);

    const response = await GET(new Request("http://localhost/api/editor/reference?siteId=site-1"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      taxonomyOverviewRows: [
        { taxonomy: "category", label: "Category", termCount: 2 },
        { taxonomy: "tag", label: "Tags", termCount: 1 },
        { taxonomy: "series", label: "Series", termCount: 3 },
      ],
      taxonomyTermsByKey: {
        category: [{ id: 11, name: "General" }],
        tag: [{ id: 22, name: "News" }],
      },
      metaKeySuggestions: ["seo_title", "_view_count"],
    });
    expect(mocks.getTaxonomyTerms).toHaveBeenCalledTimes(2);
    expect(mocks.getTaxonomyTerms).toHaveBeenNthCalledWith(1, "site-1", "category");
    expect(mocks.getTaxonomyTerms).toHaveBeenNthCalledWith(2, "site-1", "tag");
  });

  it("returns taxonomy terms through a normal GET read path", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resolveAuthorizedSiteForAnyCapability.mockResolvedValue({ site: { id: "site-1" } });
    mocks.getTaxonomyTermsPreview.mockResolvedValue([{ id: 31, name: "Preview Tag" }]);

    const response = await GET(
      new Request("http://localhost/api/editor/reference?siteId=site-1&taxonomy=series&limit=20"),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      terms: [{ id: 31, name: "Preview Tag" }],
    });
    expect(mocks.getTaxonomyTermsPreview).toHaveBeenCalledWith("site-1", "series", 20);
  });

  it("rejects direct eager editorial taxonomy reads so article/item pages stay server-seeded", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resolveAuthorizedSiteForAnyCapability.mockResolvedValue({ site: { id: "site-1" } });

    const response = await GET(
      new Request("http://localhost/api/editor/reference?siteId=site-1&taxonomy=category"),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error:
        "Eager editor taxonomies are server-seeded on article/item pages and cannot be fetched individually.",
      taxonomy: "category",
      source: "seeded-eager-taxonomy-disallowed",
    });
    expect(response.headers.get("x-tooty-editor-reference-source")).toBe("seeded-eager-taxonomy-disallowed");
    expect(mocks.getTaxonomyTerms).not.toHaveBeenCalled();
    expect(mocks.getTaxonomyTermsPreview).not.toHaveBeenCalled();
  });

  it("rejects direct eager editorial taxonomy reads even when stale clients send mixed-case taxonomy keys", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resolveAuthorizedSiteForAnyCapability.mockResolvedValue({ site: { id: "site-1" } });

    const response = await GET(
      new Request("http://localhost/api/editor/reference?siteId=site-1&taxonomy=%20TAG%20"),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error:
        "Eager editor taxonomies are server-seeded on article/item pages and cannot be fetched individually.",
      taxonomy: "tag",
      source: "seeded-eager-taxonomy-disallowed",
    });
    expect(response.headers.get("x-tooty-editor-reference-source")).toBe("seeded-eager-taxonomy-disallowed");
    expect(mocks.getTaxonomyTerms).not.toHaveBeenCalled();
    expect(mocks.getTaxonomyTermsPreview).not.toHaveBeenCalled();
  });

  it("rejects unauthorized requests", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/editor/reference?siteId=site-1"));

    expect(response.status).toBe(401);
  });
});
