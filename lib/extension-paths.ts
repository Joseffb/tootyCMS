import fs from "node:fs";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

let cachedRelativePathBases:
  | {
      cwd: string;
      bases: string[];
    }
  | null = null;

const EXTENSION_ENV_BASE_DIR_KEY = "TOOTY_CONFIG_BASE_DIR";

function resolveGitCommonDir(cwd: string) {
  const gitPath = path.join(cwd, ".git");
  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    const raw = readFileSync(gitPath, "utf8").trim();
    const match = raw.match(/^gitdir:\s*(.+)$/i);
    if (!match) return null;
    const gitDir = path.resolve(cwd, String(match[1]).trim());
    const commonDirPath = path.join(gitDir, "commondir");
    try {
      const commonDir = readFileSync(commonDirPath, "utf8").trim();
      return path.resolve(gitDir, commonDir);
    } catch {
      return gitDir;
    }
  } catch {
    return null;
  }
}

function getRelativePathBases() {
  const cwd = process.cwd();
  if (cachedRelativePathBases?.cwd === cwd) {
    return cachedRelativePathBases.bases;
  }

  const bases = [cwd];
  const gitCommonDir = resolveGitCommonDir(cwd);
  const primaryRepoRoot = gitCommonDir ? path.dirname(gitCommonDir) : "";
  if (primaryRepoRoot && !bases.includes(primaryRepoRoot)) {
    bases.push(primaryRepoRoot);
  }

  cachedRelativePathBases = { cwd, bases };
  return bases;
}

export function resolveExtensionPathFromBases(
  relativePath: string,
  bases: string[],
  pathExists: (candidate: string) => boolean = existsSync,
) {
  const candidates = bases.map((base) => path.resolve(base, relativePath));
  return candidates.find((candidate) => pathExists(candidate)) || candidates[0] || "";
}

function resolveExtensionBaseDir() {
  const configured = String(process.env[EXTENSION_ENV_BASE_DIR_KEY] || "").trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  for (const candidateName of [".env", ".env.local", ".env.test"]) {
    const candidatePath = path.join(process.cwd(), candidateName);
    try {
      if (!fs.existsSync(candidatePath)) continue;
      return path.dirname(fs.realpathSync(candidatePath));
    } catch {
      continue;
    }
  }

  return process.cwd();
}

function normalizeOnePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (path.isAbsolute(trimmed)) return trimmed;
  const bases = [resolveExtensionBaseDir(), ...getRelativePathBases()].filter(
    (base, index, allBases) => allBases.indexOf(base) === index,
  );
  return resolveExtensionPathFromBases(trimmed, bases);
}

function parseConfiguredPaths(rawValue: string | undefined, fallbackDirNames: string[]) {
  const trimmed = (rawValue || "").trim();
  const parts = (trimmed ? trimmed.split(",") : fallbackDirNames)
    .map((part) => normalizeOnePath(part))
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique;
}

export function getThemesDirs() {
  return parseConfiguredPaths(process.env.THEMES_PATH, [
    "themes",
    "../tootyCMS-themes",
    "../tootyCMS-custom-themes",
  ]);
}

export function getPluginsDirs() {
  return parseConfiguredPaths(process.env.PLUGINS_PATH, [
    "plugins",
    "../tootyCMS-plugins",
    "../tootyCMS-custom-plugins",
  ]);
}

export function getThemesDir() {
  return getThemesDirs()[0] || path.join(process.cwd(), "themes");
}

export function getPluginsDir() {
  return getPluginsDirs()[0] || path.join(process.cwd(), "plugins");
}
