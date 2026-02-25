import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { readdir, readFile } from "fs/promises";
import path from "path";
import type { ThemeTokens } from "@/lib/theme-system";
import { getThemesDirs } from "@/lib/extension-paths";
import {
  normalizeExtensionId,
  type ThemeContract,
  type ExtensionSettingsField,
  validateThemeContract,
} from "@/lib/extension-contracts";
import { CORE_VERSION, CORE_VERSION_SERIES, isCoreVersionCompatible } from "@/lib/core-version";
import { trace } from "@/lib/debug";

export type ThemeSettingsField = ExtensionSettingsField;

export type ThemeManifest = ThemeContract;
type ThemeManifestResolved = ThemeManifest & {
  sourceDir: string;
};

export type ThemeWithState = ThemeManifest & {
  enabled: boolean;
  config: Record<string, unknown>;
  sourceDir?: string;
};

export type ThemeSystemPrimaries = {
  documentation_category_slug: string;
  post_mascot_mode: "none" | "fixed_reading" | "random_non_docs";
  category_base: string;
  tag_base: string;
};

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
const DEFAULT_SITE_THEME_ID = "tooty-light";
const LEGACY_THEME_ID_ALIASES: Record<string, string> = {
  "tooty-dark": "teety-dark",
};

function resolveThemeIdAlias(themeId: string) {
  return LEGACY_THEME_ID_ALIASES[themeId] || themeId;
}

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
  const themeDirs = getThemesDirs();
  const byId = new Map<string, ThemeManifestResolved>();

  for (const themesDir of themeDirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(themesDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = path.join(themesDir, entry, "theme.json");
      try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = parseJson<unknown>(raw, {});
        const validated = validateThemeContract(parsed, entry);
        if (!validated) continue;
        if (!isCoreVersionCompatible(validated.minCoreVersion)) {
          trace("extensions", "theme skipped due core version mismatch", {
            themeId: validated.id,
            themeVersion: validated.version || "",
            minCoreVersion: validated.minCoreVersion || "",
            coreVersion: CORE_VERSION,
          });
          continue;
        }
        if (byId.has(validated.id)) {
          trace("extensions", "theme skipped due duplicate id in lower-priority path", {
            themeId: validated.id,
            sourceDir: themesDir,
          });
          continue;
        }
        byId.set(validated.id, { ...validated, sourceDir: themesDir });
      } catch {
        continue;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listThemesWithState(): Promise<ThemeWithState[]> {
  const themes = await getAvailableThemes();
  if (themes.length === 0) {
    return [
      {
        kind: "theme",
        id: DEFAULT_SITE_THEME_ID,
        name: "Tooty Light",
        description: "Built-in fallback theme",
        version: CORE_VERSION,
        minCoreVersion: CORE_VERSION_SERIES,
        tokens: fallbackTokens,
        settingsFields: [],
        enabled: true,
        config: { ...SYSTEM_THEME_PRIMARIES },
      },
    ];
  }

  const keys = themes.flatMap((theme) => {
    const legacyId = Object.entries(LEGACY_THEME_ID_ALIASES).find(([, current]) => current === theme.id)?.[0];
    return legacyId
      ? [themeEnabledKey(theme.id), themeConfigKey(theme.id), themeEnabledKey(legacyId), themeConfigKey(legacyId)]
      : [themeEnabledKey(theme.id), themeConfigKey(theme.id)];
  });
  const rows = await db.select({ key: cmsSettings.key, value: cmsSettings.value }).from(cmsSettings).where(inArray(cmsSettings.key, keys));
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return themes.map((theme) => {
    const legacyId = Object.entries(LEGACY_THEME_ID_ALIASES).find(([, current]) => current === theme.id)?.[0];
    const storedConfigRaw = byKey[themeConfigKey(theme.id)] ?? (legacyId ? byKey[themeConfigKey(legacyId)] : undefined);
    const storedConfig = storedConfigRaw ? parseJson<Record<string, unknown>>(storedConfigRaw, {}) : {};
    const enabledRaw = byKey[themeEnabledKey(theme.id)] ?? (legacyId ? byKey[themeEnabledKey(legacyId)] : undefined);
    const fieldDefaults = Object.fromEntries(
      (theme.settingsFields || [])
        .filter((field) => typeof field.defaultValue === "string")
        .map((field) => [field.key, String(field.defaultValue || "")]),
    );

    return {
      ...theme,
      enabled: enabledRaw ? enabledRaw === "true" : true,
      config: normalizeThemeConfig({
        ...fieldDefaults,
        ...storedConfig,
      }),
      sourceDir: (theme as ThemeManifestResolved).sourceDir,
    };
  });
}

export async function setThemeEnabled(themeId: string, enabled: boolean) {
  const resolvedThemeId = resolveThemeIdAlias(themeId);
  await db
    .insert(cmsSettings)
    .values({ key: themeEnabledKey(resolvedThemeId), value: enabled ? "true" : "false" })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: enabled ? "true" : "false" } });
}

export async function saveThemeConfig(themeId: string, config: Record<string, unknown>) {
  const resolvedThemeId = resolveThemeIdAlias(themeId);
  await db
    .insert(cmsSettings)
    .values({ key: themeConfigKey(resolvedThemeId), value: JSON.stringify(config) })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: JSON.stringify(config) } });
}

export async function setSiteTheme(siteId: string, themeId: string) {
  const resolvedThemeId = resolveThemeIdAlias(themeId);
  await db
    .insert(cmsSettings)
    .values({ key: siteThemeKey(siteId), value: resolvedThemeId })
    .onConflictDoUpdate({ target: cmsSettings.key, set: { value: resolvedThemeId } });
}

export async function getSiteThemeId(siteId: string) {
  const row = await db.query.cmsSettings.findFirst({
    where: eq(cmsSettings.key, siteThemeKey(siteId)),
    columns: { value: true },
  });
  const stored = String(row?.value || "").trim();
  if (!stored) return DEFAULT_SITE_THEME_ID;
  return resolveThemeIdAlias(stored);
}

export async function getSiteThemeTokens(siteId: string): Promise<ThemeTokens> {
  const [themes, selectedId] = await Promise.all([listThemesWithState(), getSiteThemeId(siteId)]);
  const enabledThemes = themes.filter((theme) => theme.enabled);
  const chosen =
    enabledThemes.find((theme) => theme.id === selectedId) ||
    enabledThemes.find((theme) => theme.id === DEFAULT_SITE_THEME_ID) ||
    enabledThemes[0] ||
    themes[0];
  return {
    ...fallbackTokens,
    ...(chosen?.tokens || {}),
  };
}
