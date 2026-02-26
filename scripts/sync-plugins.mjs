#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";

const root = process.cwd();
const siblingRoot = path.dirname(root);

const repoPlugins = process.env.PLUGINS_REPO_PATH || path.join(siblingRoot, "tootyCMS-plugins");
const corePlugins = path.join(root, "plugins");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const mode = process.argv[2] || "from-repo";
if (!["from-repo", "to-repo"].includes(mode)) {
  console.error('Usage: node scripts/sync-plugins.mjs [from-repo|to-repo]');
  process.exit(1);
}

const from = mode === "from-repo" ? repoPlugins : corePlugins;
const to = mode === "from-repo" ? corePlugins : repoPlugins;

function isPluginDirectory(baseDir, name) {
  if (!name || name.startsWith(".")) return false;
  if (name === "scripts" || name === ".github" || name === "node_modules") return false;
  const full = path.join(baseDir, name);
  if (!fs.existsSync(full)) return false;
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) return false;
  return fs.existsSync(path.join(full, "plugin.json"));
}

async function listPluginDirectories(baseDir) {
  const entries = await fsp.readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => isPluginDirectory(baseDir, name))
    .sort((a, b) => a.localeCompare(b));
}

async function removeStaleTargetEntries(targetDir, keepNames) {
  const keep = new Set(keepNames);
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const full = path.join(targetDir, name);
    const shouldRemoveMeta = name === ".github" || name === "scripts" || name === "node_modules";
    const shouldRemoveMissingPlugin = isPluginDirectory(targetDir, name) && !keep.has(name);
    if (shouldRemoveMeta || shouldRemoveMissingPlugin) {
      await fsp.rm(full, { recursive: true, force: true });
      console.log(`[sync-plugins] removed ${full}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(from)) {
    console.error(`[sync-plugins] source path does not exist: ${from}`);
    process.exit(1);
  }
  if (!fs.existsSync(to)) {
    await fsp.mkdir(to, { recursive: true });
  }

  const pluginDirs = await listPluginDirectories(from);
  await removeStaleTargetEntries(to, pluginDirs);

  for (const pluginDir of pluginDirs) {
    run("rsync", [
      "-av",
      "--delete",
      "--exclude",
      ".git",
      `${path.join(from, pluginDir)}/`,
      `${path.join(to, pluginDir)}/`,
    ]);
  }

  console.log(`[sync-plugins] ${mode} complete (${pluginDirs.length} plugin directories)`);
}

main().catch((error) => {
  console.error("[sync-plugins] failed", error);
  process.exit(1);
});
