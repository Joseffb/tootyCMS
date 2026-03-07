import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AllSites page contract", () => {
  it("does not redirect single-site users away from the sites index", () => {
    const source = readFileSync(
      "/Users/joseffbetancourt/PhpstormProjects/tooty-cms/app/app/(dashboard)/sites/page.tsx",
      "utf8",
    );

    expect(source).not.toContain("redirect(`/app/site/");
    expect(source).toContain("<Sites />");
  });
});
