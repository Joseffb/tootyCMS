import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeExtensionId,
  type PluginContract,
  type PluginEditorSnippet,
  type ExtensionFieldType,
  type ExtensionSettingsField,
  validatePluginContract,
} from "@/lib/extension-contracts";

export type PluginFieldType = ExtensionFieldType;

export type PluginSettingsField = ExtensionSettingsField;

export type PluginManifest = PluginContract;

export type PluginWithState = PluginManifest & {
  enabled: boolean;
  config: Record<string, unknown>;
};

const PLUGINS_DIR = path.join(process.cwd(), "plugins");

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
  let entries: string[] = [];
  try {
    entries = await readdir(PLUGINS_DIR);
  } catch {
    return [];
  }

  const manifests: PluginManifest[] = [];
  for (const entry of entries) {
    const manifestPath = path.join(PLUGINS_DIR, entry, "plugin.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = parseJsonObject<unknown>(raw, {});
      const validated = validatePluginContract(parsed, entry);
      if (!validated) continue;
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
