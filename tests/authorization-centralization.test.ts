import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
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

describe("authorization centralization", () => {
  it("keeps owner/admin auth checks out of app/lib codepaths", () => {
    const root = process.cwd();
    const targets = [path.join(root, "app"), path.join(root, "lib")];
    const allowedFiles = new Set([
      path.join(root, "lib", "authorization.ts"),
      path.join(root, "lib", "rbac.ts"),
      path.join(root, "lib", "site-user-tables.ts"),
    ]);

    const patterns: Array<{ label: string; regex: RegExp }> = [
      { label: "owner shortcut", regex: /site\.userId\s*[!=]==\s*session\.user\.id/ },
      { label: "content owner shortcut", regex: /\.userId\s*[!=]==\s*session\.user\.id/ },
      { label: "query owner filter shortcut", regex: /eq\([^)]*userId[^)]*session\.user\.id/ },
      { label: "admin shortcut", regex: /\bisAdministrator\s*\(/ },
      { label: "raw role capability", regex: /\broleHasCapability\s*\(/ },
      { label: "raw site role", regex: /\bgetSiteUserRole\s*\(/ },
    ];

    const offenders: Array<{ file: string; line: number; label: string; text: string }> = [];

    for (const target of targets) {
      for (const file of walkFiles(target)) {
        if (allowedFiles.has(file)) continue;
        const content = readFileSync(file, "utf8");
        const rel = path.relative(root, file).replace(/\\/g, "/");
        const ownerShortcutScope =
          rel.startsWith("app/app/(dashboard)/") ||
          rel === "components/posts.tsx" ||
          rel === "components/domain-posts.tsx";
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          for (const pattern of patterns) {
            if (
              (pattern.label === "content owner shortcut" || pattern.label === "query owner filter shortcut") &&
              !ownerShortcutScope
            ) {
              continue;
            }
            if (pattern.regex.test(line)) {
              offenders.push({
                file: rel,
                line: idx + 1,
                label: pattern.label,
                text: line.trim(),
              });
            }
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
