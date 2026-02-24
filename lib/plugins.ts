import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getPluginsDirs } from "@/lib/extension-paths";
import {
  normalizeExtensionId,
  type PluginContract,
  type PluginEditorSnippet,
  type ExtensionFieldType,
  type ExtensionSettingsField,
  validatePluginContract,
} from "@/lib/extension-contracts";
import { CORE_VERSION, isCoreVersionCompatible } from "@/lib/core-version";
import { trace } from "@/lib/debug";

export type PluginFieldType = ExtensionFieldType;

export type PluginSettingsField = ExtensionSettingsField;

export type PluginManifest = PluginContract;
type PluginManifestResolved = PluginManifest & {
  sourceDir: string;
};

export type PluginWithState = PluginManifest & {
  enabled: boolean;
  mustUse: boolean;
  config: Record<string, unknown>;
  sourceDir?: string;
};

export type PluginWithSiteState = PluginWithState & {
  siteEnabled: boolean;
  siteConfig: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
};

export function pluginEnabledKey(pluginId: string) {
  return `plugin_${pluginId}_enabled`;
}

export function pluginConfigKey(pluginId: string) {
  return `plugin_${pluginId}_config`;
}

export function pluginMustUseKey(pluginId: string) {
  return `plugin_${pluginId}_must_use`;
}

export function sitePluginEnabledKey(siteId: string, pluginId: string) {
  return `site_${siteId}_plugin_${pluginId}_enabled`;
}

export function sitePluginConfigKey(siteId: string, pluginId: string) {
  return `site_${siteId}_plugin_${pluginId}_config`;
}

function normalizePluginId(raw: string) {
  return normalizeExtensionId(raw);
}

function normalizePluginPath(pluginId: string, pathMaybe?: string) {
  if (pathMaybe && pathMaybe.startsWith("/")) return pathMaybe;
  return `/plugins/${pluginId}`;
}

function parseJsonObject<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function getAvailablePlugins(): Promise<PluginManifest[]> {
  const pluginDirs = getPluginsDirs();
  const byId = new Map<string, PluginManifestResolved>();

  for (const pluginsDir of pluginDirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(pluginsDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = path.join(pluginsDir, entry, "plugin.json");
      try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = parseJsonObject<unknown>(raw, {});
        const validated = validatePluginContract(parsed, entry);
        if (!validated) continue;
        if (!isCoreVersionCompatible(validated.minCoreVersion)) {
          trace("extensions", "plugin skipped due core version mismatch", {
            pluginId: validated.id,
            pluginVersion: validated.version || "",
            minCoreVersion: validated.minCoreVersion || "",
            coreVersion: CORE_VERSION,
          });
          continue;
        }
        if (byId.has(validated.id)) {
          trace("extensions", "plugin skipped due duplicate id in lower-priority path", {
            pluginId: validated.id,
            sourceDir: pluginsDir,
          });
          continue;
        }
        byId.set(validated.id, {
          ...validated,
          sourceDir: pluginsDir,
          menu: validated.menu
            ? {
                label: validated.menu.label?.trim() || validated.name,
                path: normalizePluginPath(validated.id, validated.menu.path),
              }
            : undefined,
        });
      } catch {
        // Ignore invalid plugin folders.
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPluginById(pluginId: string) {
  const normalized = normalizePluginId(pluginId);
  const plugins = await getAvailablePlugins();
  return plugins.find((plugin) => plugin.id === normalized) ?? null;
}

export async function getPluginEntryPath(pluginId: string): Promise<string> {
  const plugin = await getPluginById(pluginId);
  const base = (plugin as PluginManifestResolved | null)?.sourceDir || getPluginsDirs()[0] || path.join(process.cwd(), "plugins");
  return path.join(base, pluginId, "index.mjs");
}

export async function listPluginsWithState() {
  const plugins = await getAvailablePlugins();
  if (plugins.length === 0) return [] as PluginWithState[];

  const keys = plugins.flatMap((plugin) => [pluginEnabledKey(plugin.id), pluginConfigKey(plugin.id), pluginMustUseKey(plugin.id)]);
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(inArray(cmsSettings.key, keys));

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return plugins.map((plugin) => {
    const enabledRaw = byKey[pluginEnabledKey(plugin.id)];
    const configRaw = byKey[pluginConfigKey(plugin.id)];
    const mustUseRaw = byKey[pluginMustUseKey(plugin.id)];
    return {
      ...plugin,
      enabled: enabledRaw === "true",
      mustUse: mustUseRaw === "true",
      config: configRaw ? parseJsonObject<Record<string, unknown>>(configRaw, {}) : {},
      sourceDir: (plugin as PluginManifestResolved).sourceDir,
    } satisfies PluginWithState;
  });
}

export async function getEnabledPluginMenuItems() {
  const plugins = await listPluginsWithState();
  return plugins
    .filter((plugin) => plugin.enabled && plugin.menu)
    .map((plugin) => ({
      pluginId: plugin.id,
      label: plugin.menu?.label || plugin.name,
      href: normalizePluginPath(plugin.id, plugin.menu?.path),
    }));
}

export async function listPluginsWithSiteState(siteId: string): Promise<PluginWithSiteState[]> {
  const plugins = await listPluginsWithState();
  if (!plugins.length) return [];

  const keys = plugins.flatMap((plugin) => [sitePluginEnabledKey(siteId, plugin.id), sitePluginConfigKey(siteId, plugin.id)]);
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(inArray(cmsSettings.key, keys));
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return plugins.map((plugin) => {
    const enabledRaw = byKey[sitePluginEnabledKey(siteId, plugin.id)];
    const siteConfigRaw = byKey[sitePluginConfigKey(siteId, plugin.id)];
    const siteConfig = siteConfigRaw ? parseJsonObject<Record<string, unknown>>(siteConfigRaw, {}) : {};
    const effectiveConfig = plugin.mustUse ? { ...plugin.config } : { ...plugin.config, ...siteConfig };
    return {
      ...plugin,
      siteEnabled: plugin.mustUse ? true : enabledRaw === undefined ? true : enabledRaw === "true",
      siteConfig,
      effectiveConfig,
    };
  });
}

export type PluginSnippetRecord = {
  pluginId: string;
  pluginName: string;
  snippet: PluginEditorSnippet;
};
