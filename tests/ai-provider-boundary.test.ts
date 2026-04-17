import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ["app", "components", "lib", "plugins"];
const ALLOWED_PROVIDER_FILES = new Set([
  path.join(REPO_ROOT, "lib/ai-providers.ts"),
]);
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']openai["']/,
  /from\s+["']openai-edge["']/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /require\(\s*["']openai["']\s*\)/,
  /require\(\s*["']openai-edge["']\s*\)/,
  /require\(\s*["']@anthropic-ai\/sdk["']\s*\)/,
];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "coverage") continue;
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(nextPath)));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    out.push(nextPath);
  }
  return out;
}

describe("AI provider import boundaries", () => {
  it("does not import vendor SDKs outside the core AI provider adapter module", async () => {
    const files = (
      await Promise.all(SCAN_ROOTS.map((root) => walk(path.join(REPO_ROOT, root))))
    ).flat();
    const findings: Array<{ file: string; pattern: string }> = [];

    for (const file of files) {
      if (ALLOWED_PROVIDER_FILES.has(file)) continue;
      const content = await readFile(file, "utf8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({
            file: path.relative(REPO_ROOT, file),
            pattern: String(pattern),
          });
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
