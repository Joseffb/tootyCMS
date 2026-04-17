const DEFAULT_SETUP_PLUGIN_IDS = ["hello-teety", "tooty-comments", "tooty-ai"] as const;

function normalizeId(raw: string) {
  return raw.trim().toLowerCase();
}

export function getSetupDefaultPluginIds(raw: string | null | undefined) {
  const ids = new Set<string>(DEFAULT_SETUP_PLUGIN_IDS);
  for (const part of String(raw || "").split(",")) {
    const normalized = normalizeId(part);
    if (!normalized) continue;
    ids.add(normalized);
  }
  return Array.from(ids);
}

export function getSetupDefaultThemeId(raw: string | null | undefined) {
  const normalized = normalizeId(String(raw || ""));
  return normalized || null;
}
