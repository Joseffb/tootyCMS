#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
const RULES = [
  { id: "private-key", regex: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i },
  { id: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { id: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    id: "generic-secret-assignment",
    regex: /\b(api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_\-\/+=.]{16,})["']?/i,
  },
  { id: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*\b/i },
];

const SAFE_VALUE_HINTS = /(example|sample|dummy|test|fake|changeme|your_|xxxxx|<[^>]+>)/i;
const SAFE_FILE_HINTS = /(^|\/)(docs\/|README|CHANGELOG|LICENSE|\.env\.example$|\.md$)/i;

function shouldSkipFilePath(pathName) {
  return (
    /(^|\/)(node_modules|\.next|coverage|dist|build|out|test-results|logs)\//.test(pathName) ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|gz|tgz|woff2?|ttf|eot)$/i.test(pathName)
  );
}

function scanTextForSecrets(file, text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (!line.trim()) continue;
    if (SAFE_FILE_HINTS.test(file) && SAFE_VALUE_HINTS.test(line)) continue;
    for (const rule of RULES) {
      const matched = rule.regex.exec(line);
      if (!matched) continue;
      const token = matched[2] || matched[0] || "";
      if (token.length < 16) continue;
      if (/^[A-Z0-9_]+$/.test(token)) continue;
      if (token.includes("process.env.")) continue;
      if (SAFE_VALUE_HINTS.test(token)) continue;
      findings.push({
        file,
        line: i + 1,
        rule: rule.id,
        snippet: line.trim().slice(0, 200),
      });
    }
  }
  return findings;
}

function parseArgs() {
  const mode = process.argv.includes("--all") ? "all" : "staged";
  return { mode };
}

function listFiles(mode) {
  const cmd =
    mode === "all"
      ? "git ls-files"
      : "git diff --cached --name-only --diff-filter=ACMRTUXB";
  const out = execSync(cmd, { encoding: "utf8" }).trim();
  if (!out) return [];
  return out
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLikelyText(raw) {
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === 0) return false;
  }
  return true;
}

async function main() {
  const { mode } = parseArgs();
  const files = listFiles(mode).filter((file) => !shouldSkipFilePath(file));
  const findings = [];

  for (const file of files) {
    const abs = path.resolve(process.cwd(), file);
    let raw;
    try {
      raw = await fs.readFile(abs);
    } catch {
      continue;
    }
    if (!isLikelyText(raw)) continue;

    const text = raw.toString("utf8");
    const fileFindings = scanTextForSecrets(file, text);
    findings.push(...fileFindings);
  }

  if (findings.length === 0) {
    console.log(`[secrets-scan] ok (${mode})`);
    return;
  }

  console.error(`[secrets-scan] blocked: ${findings.length} potential secret(s) found`);
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("[secrets-scan] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
