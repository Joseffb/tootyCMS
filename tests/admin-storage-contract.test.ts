import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readProjectFile(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

describe("admin storage contract", () => {
  it("does not allow dashboard content components to query shared legacy data-domain tables", () => {
    const files = [
      readProjectFile("components", "domain-posts.tsx"),
      readProjectFile("components", "posts.tsx"),
    ];

    for (const source of files) {
      expect(source).not.toMatch(/db\.query\.dataDomains/);
      expect(source).not.toMatch(/db\.query\.domainPosts/);
      expect(source).not.toMatch(/from\(dataDomains\)/);
      expect(source).not.toMatch(/from\(domainPosts\)/);
    }
  });
});
