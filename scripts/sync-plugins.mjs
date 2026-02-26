#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";

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

run("rsync", ["-av", "--delete", "--exclude", ".git", `${from}/`, `${to}/`]);
console.log(`[sync-plugins] ${mode} complete`);
