import { createKernel, type MenuItem } from "@/lib/kernel";
import { createPluginExtensionApi, type PluginCapabilities } from "@/lib/extension-api";
import {
  type PluginWithState,
  type PluginWithSiteState,
  getAvailablePlugins,
  getPluginById,
  getPluginEntryPath,
  listPluginsWithState,
  listPluginsWithSiteState,
  pluginConfigKey,
  pluginEnabledKey,
  pluginNetworkRequiredKey,
  sitePluginConfigKey,
  sitePluginEnabledKey,
} from "@/lib/plugins";
import { pathToFileURL } from "url";
import { trace } from "@/lib/debug";
import { getSettingByKey, setSettingByKey } from "@/lib/settings-store";

function isAuthFilterName(name: unknown) {
  return (
    name === "auth:providers" ||
    name === "auth:adapter" ||
    name === "auth:callbacks:signIn" ||
    name === "auth:callbacks:jwt" ||
    name === "auth:callbacks:session"
  );
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setPluginEnabled(pluginId: string, enabled: boolean) {
  await setSettingByKey(pluginEnabledKey(pluginId), enabled ? "true" : "false");
}

export async function setPluginNetworkRequired(pluginId: string, networkRequired: boolean) {
  await setSettingByKey(pluginNetworkRequiredKey(pluginId), networkRequired ? "true" : "false");
}

export async function setSitePluginEnabled(siteId: string, pluginId: string, enabled: boolean) {
  await setSettingByKey(sitePluginEnabledKey(siteId, pluginId), enabled ? "true" : "false");
}

export async function saveSitePluginConfig(siteId: string, pluginId: string, config: Record<string, unknown>) {
  await setSettingByKey(sitePluginConfigKey(siteId, pluginId), JSON.stringify(config));
}

export async function savePluginConfig(pluginId: string, config: Record<string, unknown>) {
  await setSettingByKey(pluginConfigKey(pluginId), JSON.stringify(config));
}

export async function getPluginConfig(pluginId: string) {
  const value = await getSettingByKey(pluginConfigKey(pluginId));
  return parseJson<Record<string, unknown>>(value, {});
}

function toRuntimeCapabilities(plugin: PluginWithState): PluginCapabilities {
  const caps = plugin.capabilities || {};
  return {
    hooks: Boolean(caps.hooks ?? true),
    adminExtensions: Boolean(caps.adminExtensions ?? true),
    contentTypes: Boolean(caps.contentTypes ?? false),
    serverHandlers: Boolean(caps.serverHandlers ?? false),
    authExtensions: Boolean(caps.authExtensions ?? false),
    scheduleJobs: Boolean(caps.scheduleJobs ?? false),
    communicationProviders: Boolean(caps.communicationProviders ?? false),
    commentProviders: Boolean(caps.commentProviders ?? false),
    webCallbacks: Boolean(caps.webCallbacks ?? false),
  };
}

function createGuardedKernelView(
  plugin: PluginWithState,
  kernel: ReturnType<typeof createKernel>,
  capabilities: PluginCapabilities,
) {
  const pluginId = plugin.id;
  const ensure = (allowed: boolean, feature: string) => {
    if (!allowed) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginId}" attempted ${feature} without declaring the required capability.`,
      );
    }
  };

  return {
    addAction: (...args: Parameters<typeof kernel.addAction>) => {
      ensure(capabilities.hooks, "kernel.addAction");
      return kernel.addAction(...args);
    },
    addFilter: (...args: Parameters<typeof kernel.addFilter>) => {
      ensure(capabilities.hooks, "kernel.addFilter");
      if (isAuthFilterName(args[0])) {
        ensure(capabilities.authExtensions, `kernel.addFilter(${String(args[0])})`);
      }
      if (args[0] === "domain:query" && pluginId !== "export-import") {
        const originalCallback = args[1];
        const wrappedCallback = (async (value: unknown, context?: unknown) => {
          const queryName = String((context as any)?.name || "")
            .trim()
            .toLowerCase();
          if (queryName.startsWith("export_import.")) {
            trace("plugins", "blocked export/import query handler for non-migration plugin", {
              pluginId,
              queryName,
            });
            return value;
          }
          return originalCallback(value as any, context);
        }) as Parameters<typeof kernel.addFilter>[1];
        return kernel.addFilter(args[0], wrappedCallback, args[2]);
      }
      return kernel.addFilter(...args);
    },
    registerMenuLocation: (...args: Parameters<typeof kernel.registerMenuLocation>) => {
      ensure(capabilities.adminExtensions, "kernel.registerMenuLocation");
      return kernel.registerMenuLocation(...args);
    },
    addMenuItems: (...args: Parameters<typeof kernel.addMenuItems>) => {
      ensure(capabilities.adminExtensions, "kernel.addMenuItems");
      return kernel.addMenuItems(...args);
    },
    enqueueScript: (...args: Parameters<typeof kernel.enqueueScript>) => {
      ensure(capabilities.hooks, "kernel.enqueueScript");
      return kernel.enqueueScript(...args);
    },
    enqueueStyle: (...args: Parameters<typeof kernel.enqueueStyle>) => {
      ensure(capabilities.hooks, "kernel.enqueueStyle");
      return kernel.enqueueStyle(...args);
    },
    getEnqueuedAssets: (...args: Parameters<typeof kernel.getEnqueuedAssets>) => {
      ensure(capabilities.hooks, "kernel.getEnqueuedAssets");
      return kernel.getEnqueuedAssets(...args);
    },
    getMenuItems: (...args: Parameters<typeof kernel.getMenuItems>) => kernel.getMenuItems(...args),
  };
}

async function maybeRegisterPluginHooks(
  plugin: PluginWithState,
  kernel: ReturnType<typeof createKernel>,
  options?: { siteId?: string; networkRequired?: boolean },
) {
  const pluginId = plugin.id;
  const capabilities = toRuntimeCapabilities(plugin);
  const absEntry = await getPluginEntryPath(pluginId);
  try {
    // Bypass bundler module resolution so external plugin paths (PLUGINS_PATH) load reliably.
    const nativeImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<any>;
    const entryCandidates = [pathToFileURL(absEntry).href, absEntry];
    let mod: any = null;
    let lastImportError: unknown = null;
    for (const entry of entryCandidates) {
      try {
        mod = await nativeImport(entry);
        break;
      } catch (error: any) {
        lastImportError = error;
      }
    }
    if (!mod) throw lastImportError ?? new Error("Plugin runtime import failed");
    if (typeof mod?.register === "function") {
      const guardedKernel = createGuardedKernelView(plugin, kernel, capabilities);
      const guardedApi = createPluginExtensionApi(pluginId, {
        siteId: options?.siteId,
        networkRequired: Boolean(options?.networkRequired),
        capabilities,
        coreRegistry: {
          registerContentType(registration) {
            kernel.registerPluginContentType(pluginId, registration);
          },
          registerServerHandler(registration) {
            kernel.registerPluginServerHandler(pluginId, registration);
          },
          registerAuthAdapter(registration) {
            kernel.registerPluginAuthAdapter(pluginId, registration);
          },
          registerScheduleHandler(registration) {
            kernel.registerPluginScheduleHandler(pluginId, registration);
          },
          registerCommunicationProvider(registration) {
            kernel.registerPluginCommunicationProvider(pluginId, registration);
          },
          registerCommentProvider(registration) {
            kernel.registerPluginCommentProvider(pluginId, registration);
          },
          registerWebcallbackHandler(registration) {
            kernel.registerPluginWebcallbackHandler(pluginId, registration);
          },
          registerContentState(registration) {
            kernel.registerContentState(registration);
          },
          registerContentTransition(registration) {
            kernel.registerContentTransition(registration);
          },
        },
      });
      await mod.register(guardedKernel, guardedApi);
    }
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ERR_MODULE_NOT_FOUND") {
      trace("plugins", "plugin runtime entry not found", { pluginId, entry: absEntry });
      return;
    }
  trace("plugins", "plugin runtime registration failed", {
      pluginId,
      entry: absEntry,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function hasSiteState(plugin: PluginWithState): plugin is PluginWithSiteState {
  return "siteEnabled" in plugin;
}

export async function createKernelForRequest(siteId?: string) {
  const kernel = createKernel();

  kernel.registerMenuLocation("header");
  kernel.registerMenuLocation("footer");
  kernel.registerMenuLocation("dashboard");

  await kernel.doAction("kernel:init");
  await kernel.doAction("plugins:register");

  const plugins = siteId ? await listPluginsWithSiteState(siteId) : await listPluginsWithState();
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const siteScopedRun = Boolean(siteId && hasSiteState(plugin));
    if (siteScopedRun && hasSiteState(plugin) && !plugin.siteEnabled) continue;
    const capabilities = toRuntimeCapabilities(plugin);

    if (plugin.menu) {
      if (capabilities.adminExtensions) {
        kernel.addMenuItems("dashboard", [
          {
            label: plugin.menu.label || plugin.name,
            href: plugin.menu.path || `/plugins/${plugin.id}`,
            order: 90,
          },
        ]);
      } else {
        trace("plugins", "skipping dashboard menu registration due to missing adminExtensions capability", {
          pluginId: plugin.id,
        });
      }
    }

    await maybeRegisterPluginHooks(plugin, kernel, {
      siteId,
      networkRequired: siteScopedRun ? plugin.networkRequired : false,
    });
  }

  return kernel;
}

export async function getDashboardPluginMenuItems(siteId?: string): Promise<MenuItem[]> {
  const plugins = siteId ? await listPluginsWithSiteState(siteId) : await listPluginsWithState();
  const dynamicItems = plugins
    .filter((plugin) => {
      if (!plugin.enabled || !plugin.menu) return false;
      if (!siteId) return true;
      const siteEnabled = "siteEnabled" in plugin ? Boolean(plugin.siteEnabled) : true;
      return siteEnabled;
    })
    .map((plugin) => ({
      label: plugin.menu?.label || plugin.name,
      href: plugin.menu?.path || `/plugins/${plugin.id}`,
      order: Number.isFinite(Number(plugin.menu?.order)) ? Number(plugin.menu?.order) : 90,
    }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });

  return dynamicItems;
}

export { getAvailablePlugins, getPluginById, listPluginsWithState, listPluginsWithSiteState };
