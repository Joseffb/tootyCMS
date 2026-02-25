import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set([".git", ".github", "node_modules", "scripts"]);

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSemverish(value) {
  return /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value);
}

function isCoreRange(value) {
  return /^\d+\.\d+\.(?:x|\d+)(?:[-+][A-Za-z0-9.-]+)?$/.test(value);
}

async function listPluginDirs() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORE.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function validateSettingsFields(pluginDir, settingsFields) {
  if (!Array.isArray(settingsFields)) return;

  for (const [index, field] of settingsFields.entries()) {
    if (!field || typeof field !== "object") {
      fail(`${pluginDir}: settingsFields[${index}] must be an object`);
      continue;
    }

    const required = ["key", "label", "type"];
    for (const key of required) {
      if (typeof field[key] !== "string" || !field[key].trim()) {
        fail(`${pluginDir}: settingsFields[${index}] missing required string '${key}'`);
      }
    }
  }
}

async function validatePlugin(pluginDir) {
  const abs = path.join(ROOT, pluginDir);
  const manifestPath = path.join(abs, "plugin.json");

  if (!(await exists(manifestPath))) {
    fail(`${pluginDir}: missing plugin.json`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`${pluginDir}: invalid JSON in plugin.json (${error.message})`);
    return;
  }

  const requiredStrings = ["id", "name", "description", "version", "minCoreVersion", "scope", "developer", "website"];
  for (const key of requiredStrings) {
    const value = manifest[key];
    if (typeof value !== "string" || !value.trim()) {
      fail(`${pluginDir}: plugin.json missing required string '${key}'`);
    }
  }

  if (manifest.id && manifest.id !== pluginDir) {
    fail(`${pluginDir}: plugin.json id '${manifest.id}' must match folder name '${pluginDir}'`);
  }

  if (typeof manifest.version === "string" && !isSemverish(manifest.version)) {
    fail(`${pluginDir}: version '${manifest.version}' must be semver-like (e.g. 0.2.2 or 0.2.2-1)`);
  }

  if (typeof manifest.minCoreVersion === "string" && !isCoreRange(manifest.minCoreVersion)) {
    fail(`${pluginDir}: minCoreVersion '${manifest.minCoreVersion}' must look like 0.2.x or 0.2.3`);
  }

  if (typeof manifest.scope === "string" && !["site", "network"].includes(manifest.scope)) {
    fail(`${pluginDir}: scope must be one of site|network`);
  }

  if (typeof manifest.distribution !== "string" || !["core", "community"].includes(manifest.distribution)) {
    fail(`${pluginDir}: distribution must be one of core|community`);
  }

  if (manifest.website && !/^https?:\/\//.test(manifest.website)) {
    fail(`${pluginDir}: website must be an absolute http/https URL`);
  }

  if (!manifest.capabilities || typeof manifest.capabilities !== "object") {
    fail(`${pluginDir}: missing capabilities object`);
  } else {
    for (const key of ["hooks", "adminExtensions", "contentTypes", "serverHandlers"]) {
      if (typeof manifest.capabilities[key] !== "boolean") {
        fail(`${pluginDir}: capabilities.${key} must be boolean`);
      }
    }
  }

  if (manifest.menu && typeof manifest.menu === "object") {
    if (typeof manifest.menu.label !== "string" || !manifest.menu.label.trim()) {
      fail(`${pluginDir}: menu.label must be a non-empty string`);
    }
    if (typeof manifest.menu.path !== "string" || !manifest.menu.path.trim()) {
      fail(`${pluginDir}: menu.path must be a non-empty string`);
    }
  }

  validateSettingsFields(pluginDir, manifest.settingsFields);

  const hasHooks = Boolean(manifest?.capabilities?.hooks);
  const entryPath = path.join(abs, "index.mjs");
  if (hasHooks && !(await exists(entryPath))) {
    fail(`${pluginDir}: capabilities.hooks=true requires index.mjs`);
  }

  const testPath = path.join(abs, "tests", "plugin.test.ts");
  if (!(await exists(testPath))) {
    fail(`${pluginDir}: missing tests/plugin.test.ts`);
  }

  const dsStore = path.join(abs, ".DS_Store");
  if (await exists(dsStore)) {
    fail(`${pluginDir}: contains .DS_Store (remove before commit)`);
  }

  if (!hasHooks) {
    warn(`${pluginDir}: hooks disabled; runtime extension entry is optional`);
  }
}

async function main() {
  const pluginDirs = await listPluginDirs();
  if (!pluginDirs.length) {
    fail("no plugin directories found in repository root");
  }

  for (const dir of pluginDirs) {
    await validatePlugin(dir);
  }

  if (warnings.length) {
    console.log("Warnings:");
    for (const msg of warnings) console.log(`- ${msg}`);
  }

  if (errors.length) {
    console.error("Validation failed:");
    for (const msg of errors) console.error(`- ${msg}`);
    process.exit(1);
  }

  console.log(`Plugin validation passed for ${pluginDirs.length} plugin(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
