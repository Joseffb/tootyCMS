import path from "path";

function normalizeOnePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
}

function parseConfiguredPaths(rawValue: string | undefined, fallbackDirName: string) {
  const trimmed = (rawValue || "").trim();
  const parts = (trimmed ? trimmed.split(",") : [fallbackDirName])
    .map((part) => normalizeOnePath(part))
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique;
}

export function getThemesDirs() {
  return parseConfiguredPaths(process.env.THEMES_PATH, "themes");
}

export function getPluginsDirs() {
  return parseConfiguredPaths(process.env.PLUGINS_PATH, "plugins");
}

export function getThemesDir() {
  return getThemesDirs()[0] || path.join(process.cwd(), "themes");
}

export function getPluginsDir() {
  return getPluginsDirs()[0] || path.join(process.cwd(), "plugins");
}
