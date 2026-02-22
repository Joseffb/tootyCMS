import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === ".next" || entry === "node_modules" || entry === ".git") continue;
      out.push(...walkFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("rbac role guard literals", () => {
  it('does not use role comparisons against "admin"', () => {
    const root = process.cwd();
    const targets = [path.join(root, "app"), path.join(root, "lib")];
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    const pattern = /\brole\b\s*[!=]==\s*["']admin["']/;

    for (const target of targets) {
      for (const file of walkFiles(target)) {
        const content = readFileSync(file, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (pattern.test(line)) {
            offenders.push({
              file: path.relative(root, file),
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
