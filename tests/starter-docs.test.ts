import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOCS_DIR = path.join(process.cwd(), "public", "docs");
const REQUIRED_DOCS = [
  "posts_welcome_to_tooty.md",
  "pages_about_this_site.md",
  "pages_terms_of_service.md",
  "pages_privacy_policy.md",
];

describe("starter docs", () => {
  it("ships editable markdown starter documents", async () => {
    for (const file of REQUIRED_DOCS) {
      const content = await readFile(path.join(DOCS_DIR, file), "utf8");
      expect(content.trim().length).toBeGreaterThan(20);
    }
  });
});
