import db from "@/lib/db";
import { cmsSettings, dataDomains, siteDataDomains, sites } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { runThemeQueries, type ThemeQueryRequest } from "@/lib/theme-query";
import type {
  KernelFilterName,
  FilterCallback,
  KernelActionName,
  PluginAuthAdapterRegistration,
  PluginContentTypeRegistration,
  PluginServerHandlerRegistration,
} from "@/lib/kernel";

type BaseExtensionApi = {
  pluginId?: string;
  getSiteById: (siteId: string) => Promise<{
    id: string;
    name: string | null;
    subdomain: string | null;
    customDomain: string | null;
    isPrimary: boolean;
  } | null>;
  getSetting: (key: string, fallback?: string) => Promise<string>;
  getPluginSetting: (key: string, fallback?: string) => Promise<string>;
  listDataDomains: (siteId?: string) => Promise<any[]>;
};

export type PluginCapabilities = {
  hooks: boolean;
  adminExtensions: boolean;
  contentTypes: boolean;
  serverHandlers: boolean;
  authExtensions: boolean;
};

type PluginCoreRegistry = {
  registerContentType: (registration: PluginContentTypeRegistration) => void;
  registerServerHandler: (registration: PluginServerHandlerRegistration) => void;
  registerAuthAdapter: (registration: PluginAuthAdapterRegistration) => void;
};

type PluginExtensionApiOptions = {
  capabilities?: Partial<PluginCapabilities>;
  coreRegistry?: PluginCoreRegistry;
};

export type PluginExtensionApi = BaseExtensionApi & {
  setSetting: (key: string, value: string) => Promise<void>;
  setPluginSetting: (key: string, value: string) => Promise<void>;
  registerContentType: (registration: PluginContentTypeRegistration) => void;
  registerServerHandler: (registration: PluginServerHandlerRegistration) => void;
  registerAuthAdapter: (registration: PluginAuthAdapterRegistration) => void;
};

export type ThemeExtensionApi = BaseExtensionApi & {
  setSetting: (key: string, value: string) => Promise<never>;
  setPluginSetting: (key: string, value: string) => Promise<never>;
};

const DEFAULT_PLUGIN_CAPABILITIES: PluginCapabilities = {
  hooks: true,
  adminExtensions: true,
  contentTypes: false,
  serverHandlers: false,
  authExtensions: false,
};

function pluginSettingKey(pluginId: string | undefined, key: string) {
  if (!pluginId) return key;
  return `plugin_${pluginId}_${key}`;
}

function createReadBaseApi(pluginId?: string): BaseExtensionApi {
  return {
    pluginId,
    async getSiteById(siteId: string) {
      const site = await db.query.sites.findFirst({
        where: eq(sites.id, siteId),
        columns: {
          id: true,
          name: true,
          subdomain: true,
          customDomain: true,
          isPrimary: true,
        },
      });
      return site ?? null;
    },
    async getSetting(key: string, fallback = "") {
      const row = await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, key),
        columns: { value: true },
      });
      return row?.value ?? fallback;
    },
    async getPluginSetting(key: string, fallback = "") {
      const finalKey = pluginSettingKey(pluginId, key);
      const row = await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, finalKey),
        columns: { value: true },
      });
      return row?.value ?? fallback;
    },
    async listDataDomains(siteId?: string) {
      const rows = await db.select().from(dataDomains);
      if (!siteId) return rows;
      const assignments = await db
        .select({
          dataDomainId: siteDataDomains.dataDomainId,
          isActive: siteDataDomains.isActive,
        })
        .from(siteDataDomains)
        .where(eq(siteDataDomains.siteId, siteId));
      const assignmentMap = new Map(assignments.map((row) => [row.dataDomainId, row.isActive]));
      return rows.map((row) => ({
        ...row,
        isActive: assignmentMap.get(row.id) ?? false,
        assigned: assignmentMap.has(row.id),
      }));
    },
  };
}

export function createPluginExtensionApi(
  pluginId?: string,
  options?: PluginExtensionApiOptions,
): PluginExtensionApi {
  const base = createReadBaseApi(pluginId);
  const capabilities = {
    ...DEFAULT_PLUGIN_CAPABILITIES,
    ...(options?.capabilities || {}),
  };
  const pluginName = pluginId || "unknown-plugin";
  const requireCapability = (cap: keyof PluginCapabilities, featureName: string) => {
    if (!capabilities[cap]) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" attempted ${featureName} without declaring capabilities.${cap} = true`,
      );
    }
  };
  return {
    ...base,
    async setSetting(key: string, value: string) {
      await db
        .insert(cmsSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: cmsSettings.key,
          set: { value },
        });
    },
    async setPluginSetting(key: string, value: string) {
      const finalKey = pluginSettingKey(pluginId, key);
      await db
        .insert(cmsSettings)
        .values({ key: finalKey, value })
        .onConflictDoUpdate({
          target: cmsSettings.key,
          set: { value },
        });
    },
    registerContentType(registration: PluginContentTypeRegistration) {
      requireCapability("contentTypes", "registerContentType()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerContentType() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerContentType(registration);
    },
    registerServerHandler(registration: PluginServerHandlerRegistration) {
      requireCapability("serverHandlers", "registerServerHandler()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerServerHandler() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerServerHandler(registration);
    },
    registerAuthAdapter(registration: PluginAuthAdapterRegistration) {
      requireCapability("authExtensions", "registerAuthAdapter()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerAuthAdapter() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerAuthAdapter(registration);
    },
  };
}

function throwThemeSideEffectError(action: string): never {
  throw new Error(`[theme-guard] Themes cannot call side-effect API: ${action}. Use Core contracts instead.`);
}

export function createThemeExtensionApi(): ThemeExtensionApi {
  const base = createReadBaseApi(undefined);
  return {
    ...base,
    async setSetting() {
      return throwThemeSideEffectError("setSetting");
    },
    async setPluginSetting() {
      return throwThemeSideEffectError("setPluginSetting");
    },
  };
}

// Backward-compatible alias for plugin runtime call sites.
export const createExtensionApi = createPluginExtensionApi;

export async function getThemeContextApi(siteId: string, queryRequests: ThemeQueryRequest[] = []) {
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: {
      id: true,
      name: true,
      subdomain: true,
      customDomain: true,
      isPrimary: true,
    },
  });

  const domains = await createThemeExtensionApi().listDataDomains(siteId);
  const siteUrl =
    (
      await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "site_url"),
        columns: { value: true },
      })
    )?.value ?? "";

  const seoMetaTitle =
    (
      await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "seo_meta_title"),
        columns: { value: true },
      })
    )?.value ?? "";

  const seoMetaDescription =
    (
      await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "seo_meta_description"),
        columns: { value: true },
      })
    )?.value ?? "";

  const publicPluginSettingsAllowlist =
    (
      await db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "theme_public_plugin_setting_keys"),
        columns: { value: true },
      })
    )?.value ?? "";
  const allowedPluginSettingKeys = publicPluginSettingsAllowlist
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("plugin_"));
  const pluginSettings = allowedPluginSettingKeys.length
    ? await db
        .select({ key: cmsSettings.key, value: cmsSettings.value })
        .from(cmsSettings)
        .where(inArray(cmsSettings.key, allowedPluginSettingKeys))
    : [];
  const query = await runThemeQueries(siteId, queryRequests);

  return {
    site,
    settings: {
      siteUrl,
      seoMetaTitle,
      seoMetaDescription,
    },
    domains,
    pluginSettings: Object.fromEntries(pluginSettings.map((row) => [row.key, row.value])),
    query,
  };
}
