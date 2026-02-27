import db from "@/lib/db";
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
import { deleteSettingsByKeys, getSettingsByKeys, listSettingsByLikePatterns } from "@/lib/settings-store";

export type PluginFieldType = ExtensionFieldType;

export type PluginSettingsField = ExtensionSettingsField;

export type PluginManifest = PluginContract;
type PluginManifestResolved = PluginManifest & {
  sourceDir: string;
};

export type PluginWithState = PluginManifest & {
  enabled: boolean;
  networkRequired: boolean;
  config: Record<string, unknown>;
  sourceDir?: string;
};

export type PluginWithSiteState = PluginWithState & {
  siteEnabled: boolean;
  siteConfig: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
};

const DEFAULT_GLOBALLY_ENABLED_PLUGIN_IDS = new Set(["tooty-comments"]);
const DEFAULT_SITE_ENABLED_PLUGIN_IDS = new Set(["tooty-comments"]);
const PLUGIN_DISCOVERY_TTL_MS = process.env.NODE_ENV === "development" ? 2_000 : 30_000;
const loggedDuplicatePluginSkips = new Set<string>();
let pluginDiscoveryCache: { at: number; plugins: PluginManifest[] } | null = null;
let pluginDiscoveryInFlight: Promise<PluginManifest[]> | null = null;
let pluginCleanupAt = 0;

export function pluginEnabledKey(pluginId: string) {
  return `plugin_${pluginId}_enabled`;
}

export function pluginConfigKey(pluginId: string) {
  return `plugin_${pluginId}_config`;
}

export function pluginNetworkRequiredKey(pluginId: string) {
  return `plugin_${pluginId}_network_required`;
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

function parsePluginIdFromGlobalKey(key: string): string | null {
  const match = key.match(/^plugin_(.+)_(enabled|network_required|config)$/);
  if (!match) return null;
  const pluginId = String(match[1] || "").trim();
  return pluginId || null;
}

function parsePluginIdFromSiteKey(key: string): string | null {
  if (!key.startsWith("site_")) return null;
  const pluginMarker = key.indexOf("_plugin_");
  if (pluginMarker < 0) return null;
  const suffix =
    key.endsWith("_enabled") ? "_enabled" : key.endsWith("_config") ? "_config" : "";
  if (!suffix) return null;
  const pluginId = key.slice(pluginMarker + "_plugin_".length, key.length - suffix.length).trim();
  return pluginId || null;
}

async function cleanupStalePluginSettings(plugins: PluginManifest[]) {
  const installedPluginIds = new Set(plugins.map((plugin) => plugin.id));
  const rows = await listSettingsByLikePatterns([
    "plugin_%_enabled",
    "plugin_%_network_required",
    "plugin_%_config",
    "site_%_plugin_%_enabled",
    "site_%_plugin_%_config",
  ]);
  const staleKeys = rows
    .map((row) => row.key)
    .filter((key) => {
      const pluginId = parsePluginIdFromGlobalKey(key) || parsePluginIdFromSiteKey(key);
      if (!pluginId) return false;
      return !installedPluginIds.has(pluginId);
    });
  if (!staleKeys.length) return;

  await deleteSettingsByKeys(staleKeys);
  trace("extensions", "removed stale plugin settings for missing plugins", {
    removedKeys: staleKeys.length,
  });
}

export async function getAvailablePlugins(): Promise<PluginManifest[]> {
  const now = Date.now();
  if (pluginDiscoveryCache && now - pluginDiscoveryCache.at < PLUGIN_DISCOVERY_TTL_MS) {
    return pluginDiscoveryCache.plugins;
  }
  if (pluginDiscoveryInFlight) return pluginDiscoveryInFlight;
  pluginDiscoveryInFlight = (async () => {
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
          const duplicateKey = `${validated.id}::${pluginsDir}`;
          if (!loggedDuplicatePluginSkips.has(duplicateKey)) {
            loggedDuplicatePluginSkips.add(duplicateKey);
            trace("extensions", "plugin skipped due duplicate id in lower-priority path", {
              pluginId: validated.id,
              sourceDir: pluginsDir,
            });
          }
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

    const plugins = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    pluginDiscoveryCache = { at: Date.now(), plugins };
    return plugins;
  })();
  try {
    return await pluginDiscoveryInFlight;
  } finally {
    pluginDiscoveryInFlight = null;
  }
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
  const now = Date.now();
  if (now - pluginCleanupAt > PLUGIN_DISCOVERY_TTL_MS) {
    await cleanupStalePluginSettings(plugins);
    pluginCleanupAt = now;
  }

  const keys = plugins.flatMap((plugin) => [pluginEnabledKey(plugin.id), pluginConfigKey(plugin.id), pluginNetworkRequiredKey(plugin.id)]);
  const byKey = await getSettingsByKeys(keys);

  return plugins.map((plugin) => {
    const enabledRaw = byKey[pluginEnabledKey(plugin.id)];
    const configRaw = byKey[pluginConfigKey(plugin.id)];
    const networkRequiredRaw = byKey[pluginNetworkRequiredKey(plugin.id)];
    const isNetworkScope = plugin.scope === "network";
    const enabled = enabledRaw ? enabledRaw === "true" : DEFAULT_GLOBALLY_ENABLED_PLUGIN_IDS.has(plugin.id);
    return {
      ...plugin,
      enabled,
      networkRequired: isNetworkScope ? enabled : networkRequiredRaw === "true",
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
  const byKey = await getSettingsByKeys(keys);

  return plugins.map((plugin) => {
    const enabledRaw = byKey[sitePluginEnabledKey(siteId, plugin.id)];
    const siteConfigRaw = byKey[sitePluginConfigKey(siteId, plugin.id)];
    const siteConfig = siteConfigRaw ? parseJsonObject<Record<string, unknown>>(siteConfigRaw, {}) : {};
    const effectiveConfig = plugin.networkRequired ? { ...plugin.config } : { ...plugin.config, ...siteConfig };
    const siteEnabled = plugin.networkRequired
      ? enabledRaw !== "false"
      : enabledRaw
        ? enabledRaw === "true"
        : DEFAULT_SITE_ENABLED_PLUGIN_IDS.has(plugin.id);
    return {
      ...plugin,
      siteEnabled,
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
