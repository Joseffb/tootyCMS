import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  domainArchiveTemplateCandidates,
  domainDetailTemplateCandidates,
  taxonomyArchiveTemplateCandidates,
} from "@/lib/theme-fallback";

describe("theme fallback contract", () => {
  it("resolves domain detail templates without post-specific fallback", () => {
    const candidates = domainDetailTemplateCandidates("project", "fernain-jobs");
    expect(candidates).toEqual([
      "single-projects-fernain-jobs.html",
      "single-project-fernain-jobs.html",
      "single-projects.html",
      "single-project.html",
      "projects-fernain-jobs.html",
      "project-fernain-jobs.html",
      "single.html",
      "index.html",
    ]);
  });

  it("resolves domain archive templates with plural and singular keys", () => {
    const candidates = domainArchiveTemplateCandidates("project", "projects");
    expect(candidates).toEqual([
      "archive-projects.html",
      "archive-project.html",
      "archive.html",
      "projects.html",
      "project.html",
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

  it("requires built-in themes to provide single and archive fallbacks", () => {
    const themes = ["tooty-light", "teety-dark"];
    for (const themeId of themes) {
      const templateDir = path.join(process.cwd(), "themes", themeId, "templates");
      expect(existsSync(path.join(templateDir, "single.html"))).toBe(true);
      expect(existsSync(path.join(templateDir, "archive.html"))).toBe(true);
    }
  });
});
