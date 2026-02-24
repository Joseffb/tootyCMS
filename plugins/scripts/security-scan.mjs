import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([".git", ".github", "node_modules"]);
const TEXT_EXT = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".md", ".txt", ".yml", ".yaml"]);
const BANNED_EXT = new Set([".exe", ".dll", ".dylib", ".so", ".bat", ".cmd", ".ps1", ".scr", ".com", ".apk", ".jar"]);

const suspiciousPatterns = [
  { label: "eval() usage", regex: /\beval\s*\(/ },
  { label: "dynamic Function() usage", regex: /\bnew\s+Function\s*\(/ },
  { label: "node child_process import/require", regex: /(?:from\s+["']node:child_process["']|require\(["'](?:node:)?child_process["']\))/ },
  { label: "shell exec call", regex: /\b(?:exec|spawn|execFile)\s*\(/ },
  { label: "encoded PowerShell command", regex: /powershell\s+[^\n]*-enc(?:odedcommand)?/i },
  { label: "curl pipe shell", regex: /curl\s+[^\n|]+\|\s*(?:bash|sh)/i },
  { label: "wget pipe shell", regex: /wget\s+[^\n|]+\|\s*(?:bash|sh)/i }
];

const secretPatterns = [
  { label: "OpenAI key", regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: "GitHub token", regex: /\bgh[opurs]_[A-Za-z0-9]{20,}\b/ },
  { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Postgres URL with password", regex: /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/i },
  { label: "Tinybird token-like secret", regex: /\bp\.eyJ[A-Za-z0-9_\-.]{20,}\b/ }
];

const findings = [];
const SELF_SCAN_SKIP = new Set(["scripts/security-scan.mjs", "scripts/validate-plugins.mjs"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(abs);
      continue;
    }

    if (!entry.isFile()) continue;

    if (entry.name === ".DS_Store") {
      findings.push(`${rel}: disallowed file .DS_Store`);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (BANNED_EXT.has(ext)) {
      findings.push(`${rel}: disallowed executable/binary extension '${ext}'`);
      continue;
    }

    if (!TEXT_EXT.has(ext)) continue;
    if (SELF_SCAN_SKIP.has(rel)) continue;

    const content = await readFile(abs, "utf8");

    for (const rule of suspiciousPatterns) {
      if (rule.regex.test(content)) {
        findings.push(`${rel}: suspicious pattern detected (${rule.label})`);
      }
    }

    for (const rule of secretPatterns) {
      if (rule.regex.test(content)) {
        findings.push(`${rel}: potential secret detected (${rule.label})`);
      }
    }
  }
}

async function main() {
  await walk(ROOT);

  if (findings.length) {
    console.error("Security scan failed:");
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log("Security scan passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
