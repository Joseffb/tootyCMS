import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ADMIN_TARGET_DIRS = [
  path.join(ROOT, "app", "app", "(dashboard)", "plugins"),
  path.join(ROOT, "components", "plugins"),
];
const ADMIN_ALLOWED_EXTENSIONS = new Set([".tsx", ".jsx", ".html"]);
const THEME_TARGET_DIRS = [path.join(ROOT, "themes")];
const THEME_ALLOWED_EXTENSIONS = new Set([".tsx", ".jsx", ".html", ".js"]);

const failures = [];

function lineNumberForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function scanMarkup(filePath, content) {
  const checks = [
    {
      label: "button missing explicit type",
      regex: /<button\b([\s\S]*?)>/gi,
      test: (attrs) => !/\btype\s*=/.test(attrs),
    },
    {
      label: "img missing alt text",
      regex: /<img\b([\s\S]*?)>/gi,
      test: (attrs) => !/\balt\s*=/.test(attrs),
    },
  ];

  for (const check of checks) {
    let match;
    while ((match = check.regex.exec(content)) !== null) {
      const attrs = match[1] || "";
      if (!check.test(attrs)) continue;
      failures.push(`${filePath}:${lineNumberForIndex(content, match.index)} ${check.label}`);
    }
  }
}

function scanThemeBoundary(filePath, content) {
  const checks = [
    {
      label: "theme presentation file reaches /api directly",
      regex: /\bfetch\s*\(\s*["'`](?:\/api\/|https?:\/\/[^"'`]+\/api\/)/g,
    },
    {
      label: "theme presentation file references server or data runtime APIs",
      regex:
        /\b(?:@vercel\/postgres|drizzle-orm|from\s+["']pg["']|from\s+["']next\/server["']|NextResponse\b|setSettingByKey\b|sql`)\b/g,
    },
  ];

  for (const check of checks) {
    for (const match of content.matchAll(check.regex)) {
      failures.push(`${filePath}:${lineNumberForIndex(content, match.index)} ${check.label}`);
    }
  }
}

async function walk(dirPath, allowedExtensions, scanner) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, allowedExtensions, scanner);
      continue;
    }
    if (!allowedExtensions.has(path.extname(entry.name))) continue;
    const content = await readFile(abs, "utf8");
    scanner(abs, content);
  }
}

async function main() {
  for (const dir of ADMIN_TARGET_DIRS) {
    await walk(dir, ADMIN_ALLOWED_EXTENSIONS, scanMarkup);
  }
  for (const dir of THEME_TARGET_DIRS) {
    await walk(dir, THEME_ALLOWED_EXTENSIONS, scanThemeBoundary);
  }

  if (failures.length) {
    console.error("UX/a11y audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("UX/a11y audit passed for core plugin/admin surfaces.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
