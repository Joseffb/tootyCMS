import { describe, expect, it } from "vitest";
import {
  domainArchiveTemplateCandidates,
  domainDetailTemplateCandidates,
  homeTemplateCandidates,
} from "@/lib/theme-fallback";

describe("theme fallback contract", () => {
  it("keeps home fallback simple", () => {
    expect(homeTemplateCandidates("home.html")).toEqual([
      "home.html",
      "index.html",
    ]);
  });

  it("resolves domain archive with plural then singular", () => {
    expect(domainArchiveTemplateCandidates("project", "projects").slice(0, 5)).toEqual([
      "archive-projects.html",
      "archive-project.html",
      "archive.html",
      "projects.html",
      "project.html",
    ]);
  });

  it("resolves domain detail with single-domain templates first", () => {
    const candidates = domainDetailTemplateCandidates("project", "alpha");
    expect(candidates[0]).toBe("single-projects-alpha.html");
    expect(candidates).toContain("single-project.html");
    expect(candidates).toContain("single.html");
  });

  it("treats post as a normal domain archive", () => {
    expect(domainArchiveTemplateCandidates("post", "posts")).toEqual([
      "archive-posts.html",
      "archive-post.html",
      "archive.html",
      "posts.html",
      "post.html",
      "index.html",
    ]);
  });
});
