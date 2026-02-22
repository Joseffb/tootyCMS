import { describe, expect, it } from "vitest";
import { domainArchiveTemplateCandidates, domainDetailTemplateCandidates } from "@/lib/theme-fallback";

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
    ]);
  });
});
