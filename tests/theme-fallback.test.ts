import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  domainArchiveTemplateCandidates,
  domainDetailTemplateCandidates,
  homeTemplateCandidates,
  notFoundTemplateCandidates,
  taxonomyArchiveTemplateCandidates,
} from "@/lib/theme-fallback";

describe("theme fallback contract", () => {
  it("resolves domain detail templates without post-specific fallback", () => {
    const candidates = domainDetailTemplateCandidates("showcase", "fernain-jobs");
    expect(candidates).toEqual([
      "single-showcases-fernain-jobs.html",
      "single-showcase-fernain-jobs.html",
      "single-showcases.html",
      "single-showcase.html",
      "showcases-fernain-jobs.html",
      "showcase-fernain-jobs.html",
      "single.html",
      "index.html",
    ]);
  });

  it("resolves domain archive templates with plural and singular keys", () => {
    const candidates = domainArchiveTemplateCandidates("showcase", "showcases");
    expect(candidates).toEqual([
      "archive-showcases.html",
      "archive-showcase.html",
      "archive.html",
      "showcases.html",
      "showcase.html",
      "index.html",
    ]);
  });

  it("resolves taxonomy templates with deterministic fallback to index", () => {
    const categoryCandidates = taxonomyArchiveTemplateCandidates("category", "documentation");
    expect(categoryCandidates).toEqual([
      "taxonomy-category-documentation.html",
      "taxonomy-category.html",
      "tax_documentation.html",
      "tax_category_documentation.html",
      "category-documentation.html",
      "category.html",
      "taxonomy.html",
      "archive.html",
      "index.html",
    ]);
  });

  it("resolves home and not-found candidates deterministically", () => {
    expect(homeTemplateCandidates("landing.html")).toEqual([
      "landing.html",
      "home.html",
      "index.html",
    ]);
    expect(notFoundTemplateCandidates()).toEqual(["404.html", "index.html"]);
  });

  it("requires built-in themes to provide single and archive fallbacks", () => {
    const themes = ["tooty-light", "teety-dark"];
    for (const themeId of themes) {
      const templateDir = path.join(process.cwd(), "themes", themeId, "templates");
      expect(existsSync(path.join(templateDir, "index.html"))).toBe(true);
      expect(existsSync(path.join(templateDir, "single.html"))).toBe(true);
      expect(existsSync(path.join(templateDir, "archive.html"))).toBe(true);
    }
  });
});
