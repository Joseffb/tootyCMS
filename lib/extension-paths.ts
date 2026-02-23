import path from "path";

function normalizeConfiguredPath(rawValue: string | undefined, fallbackDirName: string) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return path.join(process.cwd(), fallbackDirName);
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
}

export function getThemesDir() {
  return normalizeConfiguredPath(process.env.THEMES_PATH, "themes");
}

export function getPluginsDir() {
  return normalizeConfiguredPath(process.env.PLUGINS_PATH, "plugins");
}
