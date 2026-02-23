import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getPluginsDir } from "@/lib/extension-paths";
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

export type PluginWithState = PluginManifest & {
  enabled: boolean;
  config: Record<string, unknown>;
};

export function pluginEnabledKey(pluginId: string) {
  return `plugin_${pluginId}_enabled`;
}

export function pluginConfigKey(pluginId: string) {
  return `plugin_${pluginId}_config`;
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
  const pluginsDir = getPluginsDir();
  let entries: string[] = [];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    return [];
  }

  const manifests: PluginManifest[] = [];
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
      manifests.push({
        ...validated,
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

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPluginById(pluginId: string) {
  const normalized = normalizePluginId(pluginId);
  const plugins = await getAvailablePlugins();
  return plugins.find((plugin) => plugin.id === normalized) ?? null;
}

export async function listPluginsWithState() {
  const plugins = await getAvailablePlugins();
  if (plugins.length === 0) return [] as PluginWithState[];

  const keys = plugins.flatMap((plugin) => [pluginEnabledKey(plugin.id), pluginConfigKey(plugin.id)]);
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(inArray(cmsSettings.key, keys));

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return plugins.map((plugin) => {
    const enabledRaw = byKey[pluginEnabledKey(plugin.id)];
    const configRaw = byKey[pluginConfigKey(plugin.id)];
    return {
      ...plugin,
      enabled: enabledRaw === "true",
      config: configRaw ? parseJsonObject<Record<string, unknown>>(configRaw, {}) : {},
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
