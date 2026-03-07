#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outputArg = process.argv[2];
const distDirArg = String(process.argv[3] || "").trim();
const baseArg = String(process.argv[4] || "").trim();
const basePath = path.resolve(repoRoot, baseArg || "tsconfig.json");

function sanitizeIncludes(include) {
  return include.filter((entry) => {
    const normalized = String(entry || "");
    return !normalized.startsWith(".next-test-") && !normalized.startsWith(".next-playwright-harness-");
  });
}

function createManagedTsconfig(baseConfig, distDir = "") {
  const include = sanitizeIncludes(Array.isArray(baseConfig.include) ? [...baseConfig.include] : []);
  const exclude = Array.isArray(baseConfig.exclude) ? [...baseConfig.exclude] : [];

  const nextConfig = {
    ...baseConfig,
    include,
    exclude: Array.from(new Set([...exclude, ".next-test-*/**", ".next-playwright-harness-*/**"])),
  };

  if (distDir) {
    nextConfig.include = Array.from(
      new Set([
        ...nextConfig.include,
        `${distDir}/types/**/*.ts`,
        `${distDir}/dev/types/**/*.ts`,
      ]),
    );
  }

  return nextConfig;
}

export function buildManagedTsconfig(baseConfig, distDir = "") {
  return createManagedTsconfig(baseConfig, distDir);
}

export function prepareManagedTsconfig(outputFile, distDir = "", sourceFile = basePath) {
  const base = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const nextConfig = createManagedTsconfig(base, distDir);
  fs.writeFileSync(outputFile, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

async function main() {
  if (!outputArg) {
    console.error("Usage: node ./scripts/prepare-next-tsconfig.mjs <output-path> [dist-dir] [base-path]");
    process.exit(1);
  }

  const outputPath = path.resolve(repoRoot, outputArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  prepareManagedTsconfig(outputPath, distDirArg, basePath);
  console.log(path.relative(repoRoot, outputPath));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
