import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ThemeTokens } from "@/lib/theme-system";
import {
  normalizeExtensionId,
  type ThemeContract,
  type ExtensionSettingsField,
  validateThemeContract,
} from "@/lib/extension-contracts";

export type ThemeSettingsField = ExtensionSettingsField;

export type ThemeManifest = ThemeContract;

export type ThemeWithState = ThemeManifest & {
  enabled: boolean;
  config: Record<string, unknown>;
};

export type ThemeSystemPrimaries = {
  documentation_category_slug: string;
  post_mascot_mode: "none" | "fixed_reading" | "random_non_docs";
  category_base: string;
  tag_base: string;
};

const THEMES_DIR = path.join(process.cwd(), "themes");

const fallbackTokens: ThemeTokens = {
  shellBg: "bg-[#f3e8d0]",
  shellText: "text-stone-900",
  topMuted: "text-stone-600",
  titleText: "text-stone-900",
  navText: "text-stone-700",
  navHover: "hover:text-orange-600",
};

const siteThemeKey = (siteId: string) => `site_${siteId}_theme`;
const themeEnabledKey = (themeId: string) => `theme_${themeId}_enabled`;
const themeConfigKey = (themeId: string) => `theme_${themeId}_config`;

export const SYSTEM_THEME_PRIMARIES: ThemeSystemPrimaries = {
  documentation_category_slug: "documentation",
  post_mascot_mode: "none",
  category_base: "c",
  tag_base: "t",
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return (JSON.parse(raw) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function normalizeThemeId(raw: string) {
  return normalizeExtensionId(raw);
}

function normalizeThemeConfig(raw: Record<string, unknown>) {
  const next = { ...SYSTEM_THEME_PRIMARIES, ...raw } as Record<string, unknown>;
  const docsSlug =
    typeof next.documentation_category_slug === "string" && next.documentation_category_slug.trim().length > 0
      ? next.documentation_category_slug.trim().toLowerCase()
      : SYSTEM_THEME_PRIMARIES.documentation_category_slug;
  const mascotModeRaw = String(next.post_mascot_mode || SYSTEM_THEME_PRIMARIES.post_mascot_mode).trim();
  const mascotMode: ThemeSystemPrimaries["post_mascot_mode"] =
    mascotModeRaw === "fixed_reading" || mascotModeRaw === "random_non_docs" || mascotModeRaw === "none"
      ? mascotModeRaw
      : SYSTEM_THEME_PRIMARIES.post_mascot_mode;
  const categoryBase =
    typeof next.category_base === "string" && next.category_base.trim().length > 0
      ? next.category_base.trim().toLowerCase()
      : SYSTEM_THEME_PRIMARIES.category_base;
  const tagBase =
    typeof next.tag_base === "string" && next.tag_base.trim().length > 0
      ? next.tag_base.trim().toLowerCase()
      : SYSTEM_THEME_PRIMARIES.tag_base;

  return {
    ...next,
    documentation_category_slug: docsSlug,
    post_mascot_mode: mascotMode,
    category_base: categoryBase,
    tag_base: tagBase,
  };
}

export async function getAvailableThemes(): Promise<ThemeManifest[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(THEMES_DIR);
  } catch {
    return [];
  }

  const manifests: ThemeManifest[] = [];
  for (const entry of entries) {
    const manifestPath = path.join(THEMES_DIR, entry, "theme.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = parseJson<unknown>(raw, {});
      const validated = validateThemeContract(parsed, entry);
      if (!validated) continue;
      manifests.push(validated);
    } catch {
      continue;
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listThemesWithState(): Promise<ThemeWithState[]> {
  const themes = await getAvailableThemes();
  if (themes.length === 0) {
    return [
      {
        id: "tooty-default",
        name: "Tooty Light",
        description: "Built-in fallback theme",
        version: "1.0.0",
        tokens: fallbackTokens,
        settingsFields: [],
        enabled: true,
        config: { ...SYSTEM_THEME_PRIMARIES },
      },
    ];
  }

  const keys = themes.flatMap((theme) => [themeEnabledKey(theme.id), themeConfigKey(theme.id)]);
  const rows = await db.select({ key: cmsSettings.key, value: cmsSettings.value }).from(cmsSettings).where(inArray(cmsSettings.key, keys));
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return themes.map((theme) => {
    const storedConfig = byKey[themeConfigKey(theme.id)]
      ? parseJson<Record<string, unknown>>(byKey[themeConfigKey(theme.id)], {})
      : {};
    const fieldDefaults = Object.fromEntries(
      (theme.settingsFields || [])
        .filter((field) => typeof field.defaultValue === "string")
        .map((field) => [field.key, String(field.defaultValue || "")]),
    );

    return {
      ...theme,
      enabled: byKey[themeEnabledKey(theme.id)] ? byKey[themeEnabledKey(theme.id)] === "true" : true,
      config: normalizeThemeConfig({
        ...fieldDefaults,
        ...storedConfig,
      }),
    };
  });
}

export async function setThemeEnabled(themeId: string, enabled: boolean) {
  await db
    .insert(cmsSettings)
    .values({ key: themeEnabledKey(themeId), value: enabled ? "true" : "false" })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: enabled ? "true" : "false" } });
}

export async function saveThemeConfig(themeId: string, config: Record<string, unknown>) {
  await db
    .insert(cmsSettings)
    .values({ key: themeConfigKey(themeId), value: JSON.stringify(config) })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: JSON.stringify(config) } });
}

export async function setSiteTheme(siteId: string, themeId: string) {
  await db
    .insert(cmsSettings)
    .values({ key: siteThemeKey(siteId), value: themeId })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: themeId } });
}

export async function getSiteThemeId(siteId: string) {
  const row = await db.query.cmsSettings.findFirst({
    where: eq(cmsSettings.key, siteThemeKey(siteId)),
    columns: { value: true },
  });
  return row?.value || "tooty-default";
}

export async function getSiteThemeTokens(siteId: string): Promise<ThemeTokens> {
  const [themes, selectedId] = await Promise.all([listThemesWithState(), getSiteThemeId(siteId)]);
  const enabledThemes = themes.filter((theme) => theme.enabled);
  const chosen = enabledThemes.find((theme) => theme.id === selectedId) || enabledThemes[0] || themes[0];
  return {
    ...fallbackTokens,
    ...(chosen?.tokens || {}),
  };
}
