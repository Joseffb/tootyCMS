import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOCS_DIR = path.join(process.cwd(), "public", "docs");
const REQUIRED_DOCS = [
  "welcome.md",
  "about.md",
  "terms-of-service.md",
  "privacy-policy.md",
];

describe("starter docs", () => {
  it("ships editable markdown starter documents", async () => {
    for (const file of REQUIRED_DOCS) {
      const content = await readFile(path.join(DOCS_DIR, file), "utf8");
      expect(content.trim().length).toBeGreaterThan(20);
    }
  });
});
