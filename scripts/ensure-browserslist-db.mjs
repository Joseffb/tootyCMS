#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";

const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function readInstalledVersion() {
  const require = createRequire(import.meta.url);
  let packageJsonPath = "";
  try {
    packageJsonPath = require.resolve("caniuse-lite/package.json", {
      paths: [process.cwd()],
    });
  } catch {
    return "";
  }
  if (!packageJsonPath || !fs.existsSync(packageJsonPath)) return "";
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return String(parsed?.version || "").trim();
}

async function fetchVersionPublishTime(version) {
  const response = await fetch("https://registry.npmjs.org/caniuse-lite", {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch caniuse-lite metadata: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const raw = payload?.time?.[version];
  if (!raw) return null;
  const timestamp = Date.parse(String(raw));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function runUpdate() {
  execFileSync("npx", ["update-browserslist-db@latest"], {
    stdio: "inherit",
  });
}

function parseMode() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--update")) return "update";
  if (args.has("--check-fail")) return "check-fail";
  if (args.has("--check-warn")) return "check-warn";
  return "update";
}

async function main() {
  const mode = parseMode();
  const installedVersion = readInstalledVersion();
  if (!installedVersion) {
    if (mode === "update") {
      console.log("caniuse-lite is not installed; running Browserslist DB update.");
      runUpdate();
      return;
    }
    console.log("caniuse-lite is not installed; unable to verify Browserslist DB age.");
    if (mode === "check-fail") process.exit(1);
    return;
  }

  const publishedAt = await fetchVersionPublishTime(installedVersion);
  if (!publishedAt) {
    if (mode === "update") {
      console.log(`Could not determine publish time for caniuse-lite@${installedVersion}; running update.`);
      runUpdate();
      return;
    }
    console.log(`Could not determine publish time for caniuse-lite@${installedVersion}.`);
    if (mode === "check-fail") process.exit(1);
    return;
  }

  const ageMs = Date.now() - publishedAt;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const staleMessage = `caniuse-lite@${installedVersion} is ${ageDays} days old, exceeding the ${MAX_AGE_DAYS}-day limit. Run: npm run maintenance:browserslist-db`;

  if (ageMs > MAX_AGE_MS) {
    if (mode === "update") {
      console.log(`caniuse-lite@${installedVersion} is ${ageDays} days old; updating Browserslist DB.`);
      runUpdate();
      return;
    }
    if (mode === "check-warn") {
      console.warn(staleMessage);
      return;
    }
    console.error(staleMessage);
    process.exit(1);
  }

  console.log(`caniuse-lite@${installedVersion} is ${ageDays} days old; no update required.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
