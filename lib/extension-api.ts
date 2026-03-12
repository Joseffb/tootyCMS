import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { runThemeQueries, type ThemeQueryRequest } from "@/lib/theme-query";
import { pluginConfigKey, sitePluginConfigKey } from "@/lib/plugins";
import { getSettingByKey, getSettingsByKeys, setSettingByKey } from "@/lib/settings-store";
import { setSiteTextSetting } from "@/lib/cms-config";
import type { PluginContract } from "@/lib/extension-contracts";
import type {
  PluginCommentProviderRegistration,
  ContentStateRegistration,
  ContentTransitionRegistration,
  PluginAuthProviderRegistration,
  PluginCommunicationProviderRegistration,
  PluginContentTypeRegistration,
  PluginScheduleHandlerRegistration,
  PluginWebcallbackHandlerRegistration,
} from "@/lib/kernel";
import { createScheduleEntry, deleteScheduleEntry, listScheduleEntries, updateScheduleEntry } from "@/lib/scheduler";
import { purgeCommunicationQueue, retryPendingCommunications, sendCommunication } from "@/lib/communications";
import {
  createComment,
  createTableBackedCommentProvider,
  deleteComment,
  getPublicCommentCapabilities,
  listComments,
  listCommentsForExport,
  moderateComment,
  updateComment,
} from "@/lib/comments-spine";
import { dispatchWebcallback, listRecentWebcallbackEvents, purgeWebcallbackEvents } from "@/lib/webcallbacks";
import {
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  retryPendingWebhookDeliveries,
  upsertWebhookSubscription,
} from "@/lib/webhook-delivery";
import {
  createCoreMenu,
  createCoreMenuItem,
  deleteCoreMenuByKey,
  deleteCoreMenuItem,
  getCoreMenuByKey,
  getCoreMenuDefinitionByLocation,
  getCoreMenuByLocation,
  getCoreMenuItem,
  listCoreMenuItems,
  listCoreMenus,
  normalizeCoreMenuLocation,
  updateCoreMenuByKey,
  updateCoreMenuItem,
} from "@/lib/core-menu-contract";
import type { UpsertMenuInput, UpsertMenuItemInput } from "@/lib/menu-system";
import { listSiteDataDomains } from "@/lib/site-data-domain-registry";
import {
  deleteSiteDomainPostMeta,
  getSiteDomainPostById,
  listSiteDomainPosts,
  listSiteDomainPostMeta,
  upsertSiteDomainPostMeta,
} from "@/lib/site-domain-post-store";
import { ensureSiteTaxonomyTables, getSiteTaxonomyTables, withSiteTaxonomyTableRecovery } from "@/lib/site-taxonomy-tables";
import { createCoreProfile, readCoreProfile, updateCoreProfile } from "@/lib/core-profile";
import { getSession } from "@/lib/auth";
import { getPluginOwnerForDataDomain } from "@/lib/plugin-content-types";
import { canUserManagePluginContentMeta } from "@/lib/authorization";
import { pluginRequestsContentMetaPermission } from "@/lib/plugin-permissions";
import { isPluginEditorMetaKey, pluginEditorMetaPrefix } from "@/lib/editor-plugin-tabs";

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
  scheduleJobs: boolean;
  communicationProviders: boolean;
  commentProviders: boolean;
  webCallbacks: boolean;
};

type PluginCoreRegistry = {
  registerContentType: (registration: PluginContentTypeRegistration) => void;
  registerAuthProvider: (registration: PluginAuthProviderRegistration) => void;
  registerScheduleHandler: (registration: PluginScheduleHandlerRegistration) => void;
  registerCommunicationProvider: (registration: PluginCommunicationProviderRegistration) => void;
  registerCommentProvider: (registration: PluginCommentProviderRegistration) => void;
  registerWebcallbackHandler: (registration: PluginWebcallbackHandlerRegistration) => void;
  registerContentState: (registration: ContentStateRegistration) => void;
  registerContentTransition: (registration: ContentTransitionRegistration) => void;
};

type PluginExtensionApiOptions = {
  capabilities?: Partial<PluginCapabilities>;
  coreRegistry?: PluginCoreRegistry;
  siteId?: string;
  networkRequired?: boolean;
  permissions?: PluginContract["permissions"];
};

type CoreApiInvokeInput = string | Record<string, unknown> | undefined;

type CoreContentPostRecord = {
  id: string;
  dataDomainKey: string;
  title: string;
  description: string;
  content: string;
  slug: string;
  image: string;
  layout: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

type BoundSiteCoreApi = {
  invoke: (path: string, input?: CoreApiInvokeInput) => Promise<unknown>;
  content: {
    post: {
      get: (dataDomainKey: string, postId: string) => Promise<CoreContentPostRecord | null>;
      list: (
        dataDomainKey: string,
        input?: {
          ids?: string[];
          published?: boolean;
          includeContent?: boolean;
          limit?: number;
        },
      ) => Promise<CoreContentPostRecord[]>;
    };
    meta: {
      read: (dataDomainKey: string, postId: string, key?: string) => Promise<Array<{ key: string; value: string }>>;
      set: (dataDomainKey: string, postId: string, key: string, value: string) => Promise<{ ok: true }>;
      delete: (dataDomainKey: string, postId: string, key: string) => Promise<{ ok: true }>;
    };
    hiddenMeta: {
      read: (dataDomainKey: string, postId: string, key?: string) => Promise<Array<{ key: string; value: string }>>;
      set: (dataDomainKey: string, postId: string, key: string, value: string) => Promise<{ ok: true }>;
      delete: (dataDomainKey: string, postId: string, key: string) => Promise<{ ok: true }>;
    };
  };
  menus: {
    list: () => Promise<any[]>;
    get: (menuKey: string) => Promise<any>;
    byLocation: (location: string) => Promise<any>;
    create: (input: UpsertMenuInput) => Promise<any>;
    update: (menuKey: string, input: UpsertMenuInput) => Promise<any>;
    delete: (menuKey: string) => Promise<{ ok: true }>;
    items: {
      list: (menuKey: string) => Promise<any[]>;
      get: (menuKey: string, itemId: string) => Promise<any>;
      create: (menuKey: string, input: UpsertMenuItemInput) => Promise<any>;
      update: (menuKey: string, itemId: string, input: UpsertMenuItemInput) => Promise<any>;
      delete: (menuKey: string, itemId: string) => Promise<{ ok: true }>;
    };
  };
  taxonomy: {
    list: () => Promise<Array<{ key: string; termCount: number }>>;
    terms: {
      list: (taxonomy: string) => Promise<Array<{ id: number; taxonomy: string; name: string; slug: string; parentId: number | null }>>;
    };
    edit: (taxonomy: string, input?: CoreApiInvokeInput) => Promise<{ ok: boolean; taxonomy: string; action: string }>;
  };
  dataDomain: {
    list: () => Promise<any[]>;
    postTaxonomyList: (dataDomainKey: string, postId: string) => Promise<Array<{
      taxonomy: string;
      termTaxonomyId: number;
      termId: number;
      slug: string;
      name: string;
    }>>;
  };
};

type CoreServiceApi = {
  invoke: (path: string, input?: CoreApiInvokeInput) => Promise<unknown>;
  forSite: (siteId: string) => BoundSiteCoreApi;
  site: {
    get: (siteId: string) => Promise<Awaited<ReturnType<BaseExtensionApi["getSiteById"]>>>;
  };
  profile: {
    create: (input: {
      name?: string | null;
      email?: string;
      displayName?: string;
      profileImageUrl?: string;
    }) => Promise<any>;
    read: () => Promise<any>;
    update: (input: {
      name?: string | null;
      email?: string;
      displayName?: string;
      profileImageUrl?: string;
    }) => Promise<any>;
  };
  settings: {
    get: (key: string, fallback?: string) => Promise<string>;
    set: (key: string, value: string) => Promise<void>;
  };
  dataDomain: {
    list: (siteId?: string) => Promise<any[]>;
  };
  content: {
    post: {
      get: (siteId: string, dataDomainKey: string, postId: string) => Promise<CoreContentPostRecord | null>;
      list: (
        siteId: string,
        dataDomainKey: string,
        input?: {
          ids?: string[];
          published?: boolean;
          includeContent?: boolean;
          limit?: number;
        },
      ) => Promise<CoreContentPostRecord[]>;
    };
    meta: {
      read: (
        siteId: string,
        dataDomainKey: string,
        postId: string,
        key?: string,
      ) => Promise<Array<{ key: string; value: string }>>;
      set: (siteId: string, dataDomainKey: string, postId: string, key: string, value: string) => Promise<{ ok: true }>;
      delete: (siteId: string, dataDomainKey: string, postId: string, key: string) => Promise<{ ok: true }>;
    };
    hiddenMeta: {
      read: (
        siteId: string,
        dataDomainKey: string,
        postId: string,
        key?: string,
      ) => Promise<Array<{ key: string; value: string }>>;
      set: (siteId: string, dataDomainKey: string, postId: string, key: string, value: string) => Promise<{ ok: true }>;
      delete: (siteId: string, dataDomainKey: string, postId: string, key: string) => Promise<{ ok: true }>;
    };
  };
  menus: {
    list: (siteId?: string) => Promise<any[]>;
    get: (siteId: string, menuKey: string) => Promise<any>;
    byLocation: (siteId: string, location: string) => Promise<any>;
    create: (siteId: string, input: UpsertMenuInput) => Promise<any>;
    update: (siteId: string, menuKey: string, input: UpsertMenuInput) => Promise<any>;
    delete: (siteId: string, menuKey: string) => Promise<{ ok: true }>;
    items: {
      list: (siteId: string, menuKey: string) => Promise<any[]>;
      get: (siteId: string, menuKey: string, itemId: string) => Promise<any>;
      create: (siteId: string, menuKey: string, input: UpsertMenuItemInput) => Promise<any>;
      update: (siteId: string, menuKey: string, itemId: string, input: UpsertMenuItemInput) => Promise<any>;
      delete: (siteId: string, menuKey: string, itemId: string) => Promise<{ ok: true }>;
    };
  };
  taxonomy: {
    list: () => Promise<Array<{ key: string; termCount: number }>>;
    edit: (taxonomy: string, input?: CoreApiInvokeInput) => Promise<{ ok: boolean; taxonomy: string; action: string }>;
    terms: {
      list: (taxonomy: string) => Promise<Array<{ id: number; taxonomy: string; name: string; slug: string; parentId: number | null }>>;
      meta: {
        get: (termTaxonomyId: number) => Promise<Array<{ key: string; value: string }>>;
        set: (termTaxonomyId: number, key: string, value: string) => Promise<{ ok: boolean }>;
      };
    };
  };
  schedule: {
    create: (input: {
      siteId?: string | null;
      name: string;
      actionKey: string;
      payload?: Record<string, unknown>;
      enabled?: boolean;
      runEveryMinutes?: number;
      nextRunAt?: Date;
    }) => Promise<any>;
    list: () => Promise<any[]>;
    update: (
      scheduleId: string,
      input: {
        siteId?: string | null;
        name?: string;
        actionKey?: string;
        payload?: Record<string, unknown>;
        enabled?: boolean;
        runEveryMinutes?: number;
        nextRunAt?: Date;
      },
    ) => Promise<any>;
    delete: (scheduleId: string) => Promise<void>;
  };
  messaging: {
    send: typeof sendCommunication;
    retryPending: typeof retryPendingCommunications;
    purge: typeof purgeCommunicationQueue;
  };
  comments: {
    getPublicCapabilities: (siteId: string) => Promise<{
      commentsVisibleToPublic: boolean;
      canPostAuthenticated: boolean;
      canPostAnonymously: boolean;
      anonymousIdentityFields: {
        name: boolean;
        email: boolean;
      };
    }>;
    createTableBackedProvider: (
      input?: Partial<PluginCommentProviderRegistration>,
    ) => PluginCommentProviderRegistration;
    create: typeof createComment;
    list: typeof listComments;
    update: typeof updateComment;
    delete: typeof deleteComment;
    moderate: typeof moderateComment;
    listForExport: typeof listCommentsForExport;
  };
  webcallbacks: {
    dispatch: typeof dispatchWebcallback;
    listRecent: typeof listRecentWebcallbackEvents;
    purge: typeof purgeWebcallbackEvents;
  };
  webhooks: {
    subscriptions: {
      list: typeof listWebhookSubscriptions;
      upsert: typeof upsertWebhookSubscription;
      delete: typeof deleteWebhookSubscription;
    };
    deliveries: {
      retryPending: typeof retryPendingWebhookDeliveries;
    };
  };
};

type CoreContentMetaReadApi = {
  read: (
    siteId: string,
    dataDomainKey: string,
    postId: string,
    key?: string,
  ) => Promise<Array<{ key: string; value: string }>>;
};

type CoreContentMetaMutationApi = CoreContentMetaReadApi & {
  set: (siteId: string, dataDomainKey: string, postId: string, key: string, value: string) => Promise<{ ok: true }>;
  delete: (siteId: string, dataDomainKey: string, postId: string, key: string) => Promise<{ ok: true }>;
};

type CoreContentHiddenMetaMutationApi = CoreContentMetaMutationApi;

export type PluginExtensionApi = BaseExtensionApi & {
  core: CoreServiceApi;
  setSetting: (key: string, value: string) => Promise<void>;
  setPluginSetting: (key: string, value: string) => Promise<void>;
  registerContentType: (registration: PluginContentTypeRegistration) => void;
  registerAuthProvider: (registration: PluginAuthProviderRegistration) => void;
  registerScheduleHandler: (registration: PluginScheduleHandlerRegistration) => void;
  registerCommunicationProvider: (registration: PluginCommunicationProviderRegistration) => void;
  registerCommentProvider: (registration: PluginCommentProviderRegistration) => void;
  registerWebcallbackHandler: (registration: PluginWebcallbackHandlerRegistration) => void;
  registerContentState: (registration: ContentStateRegistration) => void;
  registerContentTransition: (registration: ContentTransitionRegistration) => void;
  createSchedule: (input: {
    siteId?: string | null;
    name: string;
    actionKey: string;
    payload?: Record<string, unknown>;
    enabled?: boolean;
    runEveryMinutes?: number;
    nextRunAt?: Date;
  }) => Promise<any>;
  listSchedules: () => Promise<any[]>;
  updateSchedule: (
    scheduleId: string,
    input: {
      siteId?: string | null;
      name?: string;
      actionKey?: string;
      payload?: Record<string, unknown>;
      enabled?: boolean;
      runEveryMinutes?: number;
      nextRunAt?: Date;
    },
  ) => Promise<any>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
};

export type ThemeExtensionApi = BaseExtensionApi & {
  core: Pick<CoreServiceApi, "site" | "profile" | "settings" | "dataDomain" | "taxonomy" | "menus"> & {
    content: {
      post: {
        get: (siteId: string, dataDomainKey: string, postId: string) => Promise<CoreContentPostRecord | null>;
        list: (
          siteId: string,
          dataDomainKey: string,
          input?: {
            ids?: string[];
            published?: boolean;
            includeContent?: boolean;
            limit?: number;
          },
        ) => Promise<CoreContentPostRecord[]>;
      };
      meta: CoreContentMetaReadApi;
    };
  };
  setSetting: (key: string, value: string) => Promise<never>;
  setPluginSetting: (key: string, value: string) => Promise<never>;
  createSchedule: (input: {
    siteId?: string | null;
    name: string;
    actionKey: string;
    payload?: Record<string, unknown>;
    enabled?: boolean;
    runEveryMinutes?: number;
    nextRunAt?: Date;
  }) => Promise<any>;
  listSchedules: () => Promise<any[]>;
  updateSchedule: (
    scheduleId: string,
    input: {
      siteId?: string | null;
      name?: string;
      actionKey?: string;
      payload?: Record<string, unknown>;
      enabled?: boolean;
      runEveryMinutes?: number;
      nextRunAt?: Date;
    },
  ) => Promise<any>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
};

const DEFAULT_PLUGIN_CAPABILITIES: PluginCapabilities = {
  hooks: true,
  adminExtensions: true,
  contentTypes: false,
  serverHandlers: false,
  authExtensions: false,
  scheduleJobs: false,
  communicationProviders: false,
  commentProviders: false,
  webCallbacks: false,
};

function pluginSettingKey(pluginId: string | undefined, key: string) {
  if (!pluginId) return key;
  return `plugin_${pluginId}_${key}`;
}

function parseJsonObject<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTaxonomyKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "");
}

function normalizeMetaKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 80);
}

async function getSiteTaxonomyScope(siteId: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  await ensureSiteTaxonomyTables(normalizedSiteId);
  return getSiteTaxonomyTables(normalizedSiteId);
}

async function withSiteTaxonomyScope<T>(
  siteId: string,
  run: (tables: Awaited<ReturnType<typeof getSiteTaxonomyScope>>) => Promise<T>,
) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    throw new Error("siteId is required");
  }
  return withSiteTaxonomyTableRecovery(normalizedSiteId, async () => {
    const tables = await getSiteTaxonomyScope(normalizedSiteId);
    return run(tables);
  });
}

function parseCommandInput(input?: CoreApiInvokeInput): Record<string, string> {
  if (typeof input === "string") {
    const [rawKey, ...rest] = input.split(":");
    const key = String(rawKey || "").trim().toLowerCase();
    const value = rest.join(":").trim();
    return key ? { [key]: value } : {};
  }
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    out[String(key).trim().toLowerCase()] = String(value ?? "").trim();
  }
  return out;
}

function parseMenuInput(input?: CoreApiInvokeInput): UpsertMenuInput {
  const command = parseCommandInput(input);
  return {
    key: String(command.key || ""),
    title: String(command.title || ""),
    description: String(command.description || ""),
    location: String(command.location || "unassigned") as UpsertMenuInput["location"],
    sortOrder: Number(command.sortorder || command.sort_order || 10),
  };
}

function parseMenuItemInput(input?: CoreApiInvokeInput): UpsertMenuItemInput {
  const command = parseCommandInput(input);
  return {
    title: String(command.title || ""),
    href: String(command.href || ""),
    description: String(command.description || ""),
    parentId: String(command.parentid || command.parent_id || ""),
    mediaId: String(command.mediaid || command.media_id || ""),
    target: String(command.target || ""),
    rel: String(command.rel || ""),
    external: String(command.external || "").toLowerCase() === "true",
    enabled: command.enabled ? String(command.enabled).toLowerCase() !== "false" : true,
    sortOrder: Number(command.sortorder || command.sort_order || 10),
    meta: parseJsonObject<Record<string, string>>(command.meta, {}),
  };
}

function parseProfileInput(input?: CoreApiInvokeInput) {
  const command = parseCommandInput(input);
  return {
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.email !== undefined ? { email: command.email } : {}),
    ...(command.displayname !== undefined || command.display_name !== undefined
      ? { displayName: command.displayname || command.display_name || "" }
      : {}),
    ...(command.profileimageurl !== undefined ||
    command.profile_image_url !== undefined ||
    command.imageurl !== undefined ||
    command.image_url !== undefined
      ? {
          profileImageUrl:
            command.profileimageurl ||
            command.profile_image_url ||
            command.imageurl ||
            command.image_url ||
            "",
        }
      : {}),
  };
}

function normalizeContentMetaEntries(
  entries: Array<{ key: string; value: string }>,
  key?: string,
) {
  const normalizedKey = key === undefined ? "" : normalizeMetaKey(key);
  if (!normalizedKey) return entries;
  return entries.filter((entry) => entry.key === normalizedKey);
}

function formatCoreContentPostRecord(
  post: Awaited<ReturnType<typeof getSiteDomainPostById>>,
): CoreContentPostRecord | null {
  if (!post) return null;
  return {
    id: String(post.id || ""),
    dataDomainKey: String(post.dataDomainKey || ""),
    title: String(post.title || ""),
    description: String(post.description || ""),
    content: String(post.content || ""),
    slug: String(post.slug || ""),
    image: String(post.image || ""),
    layout: post.layout == null ? null : String(post.layout),
    published: Boolean(post.published),
    createdAt:
      post.createdAt instanceof Date
        ? post.createdAt.toISOString()
        : new Date(String(post.createdAt || "")).toISOString(),
    updatedAt:
      post.updatedAt instanceof Date
        ? post.updatedAt.toISOString()
        : new Date(String(post.updatedAt || "")).toISOString(),
  };
}

function createReadBaseApi(pluginId?: string, options?: PluginExtensionApiOptions): BaseExtensionApi {
  const boundSiteId = options?.siteId;
  const useGlobalOnly = Boolean(options?.networkRequired);
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
      return (await getSettingByKey(key)) ?? fallback;
    },
    async getPluginSetting(key: string, fallback = "") {
      const finalKey = pluginSettingKey(pluginId, key);
      if (!pluginId) return (await getSettingByKey(finalKey)) ?? fallback;

      const globalConfigLookupKey = pluginConfigKey(pluginId);
      const siteConfigLookupKey = boundSiteId ? sitePluginConfigKey(boundSiteId, pluginId) : "";
      const siteLegacyLookupKey = boundSiteId ? `site_${boundSiteId}_${finalKey}` : "";
      const lookupKeys = [globalConfigLookupKey, finalKey];
      if (boundSiteId) {
        if (!useGlobalOnly) lookupKeys.push(siteLegacyLookupKey);
        lookupKeys.push(siteConfigLookupKey);
      }

      const byKey = await getSettingsByKeys(lookupKeys);

      if (boundSiteId && !useGlobalOnly) {
        const siteLegacyValue = byKey[siteLegacyLookupKey];
        if (siteLegacyValue !== undefined) return siteLegacyValue;
      }

      if (boundSiteId && !useGlobalOnly) {
        const siteConfig = parseJsonObject<Record<string, unknown>>(byKey[siteConfigLookupKey], {});
        const siteValue = siteConfig[key];
        if (siteValue !== undefined && siteValue !== null) return String(siteValue);
      }

      const globalConfig = parseJsonObject<Record<string, unknown>>(byKey[globalConfigLookupKey], {});
      const globalValue = globalConfig[key];
      if (globalValue !== undefined && globalValue !== null) return String(globalValue);

      return byKey[finalKey] ?? fallback;
    },
    async listDataDomains(siteId?: string) {
      const normalizedSiteId = String(siteId || "").trim();
      if (normalizedSiteId) {
        return listSiteDataDomains(normalizedSiteId, { includeInactive: true });
      }

      const siteRows = await db.select({ id: sites.id }).from(sites);
      const byKey = new Map<string, any>();
      for (const row of siteRows) {
        const currentSiteId = String(row.id || "").trim();
        if (!currentSiteId) continue;
        const domains = await listSiteDataDomains(currentSiteId, { includeInactive: true });
        for (const domain of domains) {
          if (byKey.has(domain.key)) continue;
          byKey.set(domain.key, {
            ...domain,
            assigned: true,
            siteId: currentSiteId,
          });
        }
      }
      return Array.from(byKey.values());
    },
  };
}

export function createPluginExtensionApi(
  pluginId?: string,
  options?: PluginExtensionApiOptions,
): PluginExtensionApi {
  const base = createReadBaseApi(pluginId, options);
  const capabilities = {
    ...DEFAULT_PLUGIN_CAPABILITIES,
    ...(options?.capabilities || {}),
  };
  const requestedContentMetaPermission = pluginRequestsContentMetaPermission({
    id: pluginId,
    permissions: options?.permissions,
  });
  const pluginName = pluginId || "unknown-plugin";
  const requireCapability = (cap: keyof PluginCapabilities, featureName: string) => {
    if (!capabilities[cap]) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" attempted ${featureName} without declaring capabilities.${cap} = true`,
      );
    }
  };
  const setSetting: PluginExtensionApi["setSetting"] = async (key, value) => {
    await setSettingByKey(key, value);
  };

  const setPluginSetting: PluginExtensionApi["setPluginSetting"] = async (key, value) => {
    const finalKey = pluginSettingKey(pluginId, key);
    await setSettingByKey(finalKey, value);
  };

  const registerContentType: PluginExtensionApi["registerContentType"] = (registration) => {
      requireCapability("contentTypes", "registerContentType()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerContentType() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerContentType(registration);
    };

  const registerAuthProvider: PluginExtensionApi["registerAuthProvider"] = (registration) => {
      requireCapability("authExtensions", "registerAuthProvider()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerAuthProvider() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerAuthProvider(registration);
    };

  const registerScheduleHandler: PluginExtensionApi["registerScheduleHandler"] = (registration) => {
      requireCapability("scheduleJobs", "registerScheduleHandler()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerScheduleHandler() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerScheduleHandler(registration);
    };

  const registerCommunicationProvider: PluginExtensionApi["registerCommunicationProvider"] = (registration) => {
      requireCapability("communicationProviders", "registerCommunicationProvider()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerCommunicationProvider() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerCommunicationProvider(registration);
    };

  const registerCommentProvider: PluginExtensionApi["registerCommentProvider"] = (registration) => {
      requireCapability("commentProviders", "registerCommentProvider()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerCommentProvider() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerCommentProvider(registration);
    };

  const registerWebcallbackHandler: PluginExtensionApi["registerWebcallbackHandler"] = (registration) => {
      requireCapability("webCallbacks", "registerWebcallbackHandler()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerWebcallbackHandler() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerWebcallbackHandler(registration);
    };

  const registerContentState: PluginExtensionApi["registerContentState"] = (registration) => {
      requireCapability("hooks", "registerContentState()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerContentState() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerContentState(registration);
    };

  const registerContentTransition: PluginExtensionApi["registerContentTransition"] = (registration) => {
      requireCapability("hooks", "registerContentTransition()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerContentTransition() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerContentTransition(registration);
    };

  const createSchedule: PluginExtensionApi["createSchedule"] = async (input) => {
      requireCapability("scheduleJobs", "createSchedule()");
      return createScheduleEntry("plugin", pluginName, {
        siteId: input.siteId || null,
        name: input.name,
        actionKey: input.actionKey,
        payload: input.payload || {},
        enabled: input.enabled ?? true,
        runEveryMinutes: input.runEveryMinutes ?? 60,
        nextRunAt: input.nextRunAt,
      } as any);
    };

  const listSchedules: PluginExtensionApi["listSchedules"] = async () => {
      requireCapability("scheduleJobs", "listSchedules()");
      return listScheduleEntries({ ownerType: "plugin", ownerId: pluginName, includeDisabled: true });
    };

  const updateSchedule: PluginExtensionApi["updateSchedule"] = async (scheduleId, input) => {
      requireCapability("scheduleJobs", "updateSchedule()");
      await updateScheduleEntry(scheduleId, {
        siteId: input.siteId === undefined ? undefined : input.siteId || null,
        name: input.name,
        actionKey: input.actionKey,
        payload: input.payload,
        enabled: input.enabled,
        runEveryMinutes: input.runEveryMinutes,
        nextRunAt: input.nextRunAt,
      } as any, {
        isAdmin: false,
        ownerType: "plugin",
        ownerId: pluginName,
      });
      return listScheduleEntries({ ownerType: "plugin", ownerId: pluginName, includeDisabled: true });
    };

  const deleteSchedule: PluginExtensionApi["deleteSchedule"] = async (scheduleId) => {
      requireCapability("scheduleJobs", "deleteSchedule()");
      await deleteScheduleEntry(scheduleId, {
        isAdmin: false,
        ownerType: "plugin",
        ownerId: pluginName,
      });
    };

  const resolveTaxonomySiteId = (siteId?: string) => {
    const resolved = String(siteId || options?.siteId || "").trim();
    if (!resolved) {
      throw new Error(`[plugin-guard] Plugin "${pluginName}" taxonomy API requires a bound site or explicit siteId.`);
    }
    return resolved;
  };

  const resolveContentMetaSiteId = (siteId?: string) => {
    const resolved = String(siteId || options?.siteId || "").trim();
    if (!resolved) {
      throw new Error(`[plugin-guard] Plugin "${pluginName}" content meta API requires a bound site or explicit siteId.`);
    }
    return resolved;
  };

  const resolvePluginOwnedContentMetaContext = async (siteId: string, dataDomainKey: string, postId: string) => {
    if (!pluginId) {
      throw new Error("[plugin-guard] Plugin content meta API requires a plugin id.");
    }
    if (!requestedContentMetaPermission) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" attempted core.content.meta without declaring permissions.contentMeta.requested = true`,
      );
    }
    const resolvedSiteId = resolveContentMetaSiteId(siteId);
    const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
    const normalizedPostId = String(postId || "").trim();
    if (!normalizedDomainKey || !normalizedPostId) {
      throw new Error("siteId, dataDomainKey, and postId are required");
    }
    const ownerPluginId = await getPluginOwnerForDataDomain(resolvedSiteId, normalizedDomainKey);
    if (!ownerPluginId || ownerPluginId !== String(pluginId).trim().toLowerCase()) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" may only manage content meta for its own plugin-owned content.`,
      );
    }
    const post = await getSiteDomainPostById({
      siteId: resolvedSiteId,
      dataDomainKey: normalizedDomainKey,
      postId: normalizedPostId,
    });
    if (!post) throw new Error("Domain post not found.");
    return {
      siteId: resolvedSiteId,
      dataDomainKey: normalizedDomainKey,
      postId: normalizedPostId,
    };
  };

  const resolvePluginOwnedContentPostDomain = async (siteId: string, dataDomainKey: string) => {
    if (!pluginId) {
      throw new Error("[plugin-guard] Plugin content post API requires a plugin id.");
    }
    const resolvedSiteId = resolveContentMetaSiteId(siteId);
    const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
    if (!normalizedDomainKey) {
      throw new Error("dataDomainKey is required");
    }
    const ownerPluginId = await getPluginOwnerForDataDomain(resolvedSiteId, normalizedDomainKey);
    if (!ownerPluginId || ownerPluginId !== String(pluginId).trim().toLowerCase()) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" may only read content posts for its own plugin-owned content.`,
      );
    }
    return {
      siteId: resolvedSiteId,
      dataDomainKey: normalizedDomainKey,
    };
  };

  const pluginContentPostApi = {
    get: async (siteId: string, dataDomainKey: string, postId: string) => {
      const context = await resolvePluginOwnedContentPostDomain(siteId, dataDomainKey);
      const post = await getSiteDomainPostById({
        siteId: context.siteId,
        dataDomainKey: context.dataDomainKey,
        postId: String(postId || "").trim(),
      });
      return formatCoreContentPostRecord(post);
    },
    list: async (
      siteId: string,
      dataDomainKey: string,
      input?: {
        ids?: string[];
        published?: boolean;
        includeContent?: boolean;
        limit?: number;
      },
    ) => {
      const context = await resolvePluginOwnedContentPostDomain(siteId, dataDomainKey);
      const rows = await listSiteDomainPosts({
        siteId: context.siteId,
        dataDomainKey: context.dataDomainKey,
        includeInactiveDomains: true,
        includeContent: Boolean(input?.includeContent),
        published: typeof input?.published === "boolean" ? input.published : undefined,
        ids: Array.isArray(input?.ids) ? input?.ids : undefined,
        limit: Number.isFinite(Number(input?.limit)) ? Math.max(1, Math.trunc(Number(input?.limit))) : undefined,
      });
      return rows.map((row) => formatCoreContentPostRecord(row)).filter((row): row is CoreContentPostRecord => Boolean(row));
    },
  };

  const requirePluginContentMetaMutationAccess = async (siteId: string) => {
    if (!pluginId) {
      throw new Error("[plugin-guard] Plugin content meta mutation requires a plugin id.");
    }
    const session = await getSession();
    const userId = String(session?.user?.id || "").trim();
    if (!userId) throw new Error("Not authenticated");
    const allowed = await canUserManagePluginContentMeta(userId, siteId, pluginId);
    if (!allowed) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" content meta mutation requires manage_plugin_content_meta or manage_plugin_${pluginId}_content_meta.`,
      );
    }
  };

  const pluginContentMetaApi: CoreContentMetaMutationApi = {
    read: async (siteId, dataDomainKey, postId, key) => {
      const context = await resolvePluginOwnedContentMetaContext(siteId, dataDomainKey, postId);
      const entries = await listSiteDomainPostMeta(context);
      return normalizeContentMetaEntries(entries, key);
    },
    set: async (siteId, dataDomainKey, postId, key, value) => {
      const context = await resolvePluginOwnedContentMetaContext(siteId, dataDomainKey, postId);
      await requirePluginContentMetaMutationAccess(context.siteId);
      const metaKey = normalizeMetaKey(key);
      if (!metaKey) throw new Error("meta key is required");
      await upsertSiteDomainPostMeta({
        ...context,
        key: metaKey,
        value: String(value ?? ""),
      });
      return { ok: true };
    },
    delete: async (siteId, dataDomainKey, postId, key) => {
      const context = await resolvePluginOwnedContentMetaContext(siteId, dataDomainKey, postId);
      await requirePluginContentMetaMutationAccess(context.siteId);
      const metaKey = normalizeMetaKey(key);
      if (!metaKey) throw new Error("meta key is required");
      await deleteSiteDomainPostMeta({
        ...context,
        key: metaKey,
      });
      return { ok: true };
    },
  };

  const normalizePluginHiddenMetaKey = (key: string) => {
    const normalized = normalizeMetaKey(key);
    if (!normalized) throw new Error("meta key is required");
    const prefix = pluginEditorMetaPrefix(String(pluginId || ""));
    if (!normalized.startsWith(prefix)) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" hidden article meta key must stay within ${prefix}* namespace.`,
      );
    }
    return normalized;
  };

  const resolvePluginScopedHiddenMetaContext = async (siteId: string, dataDomainKey: string, postId: string) => {
    if (!pluginId) {
      throw new Error("[plugin-guard] Plugin hidden article meta API requires a plugin id.");
    }
    if (!requestedContentMetaPermission) {
      throw new Error(
        `[plugin-guard] Plugin "${pluginName}" attempted core.content.hiddenMeta without declaring permissions.contentMeta.requested = true`,
      );
    }
    const resolvedSiteId = resolveContentMetaSiteId(siteId);
    const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
    const normalizedPostId = String(postId || "").trim();
    if (!normalizedDomainKey || !normalizedPostId) {
      throw new Error("siteId, dataDomainKey, and postId are required");
    }
    const post = await getSiteDomainPostById({
      siteId: resolvedSiteId,
      dataDomainKey: normalizedDomainKey,
      postId: normalizedPostId,
    });
    if (!post) throw new Error("Domain post not found.");
    return {
      siteId: resolvedSiteId,
      dataDomainKey: normalizedDomainKey,
      postId: normalizedPostId,
    };
  };

  const pluginHiddenMetaApi: CoreContentHiddenMetaMutationApi = {
    read: async (siteId, dataDomainKey, postId, key) => {
      const context = await resolvePluginScopedHiddenMetaContext(siteId, dataDomainKey, postId);
      const entries = await listSiteDomainPostMeta(context);
      if (key) {
        const metaKey = normalizePluginHiddenMetaKey(key);
        return normalizeContentMetaEntries(entries, metaKey);
      }
      return normalizeContentMetaEntries(
        entries.filter((entry) => isPluginEditorMetaKey(String(pluginId || ""), entry.key)),
      );
    },
    set: async (siteId, dataDomainKey, postId, key, value) => {
      const context = await resolvePluginScopedHiddenMetaContext(siteId, dataDomainKey, postId);
      await requirePluginContentMetaMutationAccess(context.siteId);
      const metaKey = normalizePluginHiddenMetaKey(key);
      await upsertSiteDomainPostMeta({
        ...context,
        key: metaKey,
        value: String(value ?? ""),
      });
      return { ok: true };
    },
    delete: async (siteId, dataDomainKey, postId, key) => {
      const context = await resolvePluginScopedHiddenMetaContext(siteId, dataDomainKey, postId);
      await requirePluginContentMetaMutationAccess(context.siteId);
      const metaKey = normalizePluginHiddenMetaKey(key);
      await deleteSiteDomainPostMeta({
        ...context,
        key: metaKey,
      });
      return { ok: true };
    },
  };

  const listTaxonomies = async (siteId?: string) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    return withSiteTaxonomyScope(resolvedSiteId, async ({ termTaxonomiesTable }) =>
      db
        .select({
          key: termTaxonomiesTable.taxonomy,
          termCount: sql<number>`count(${termTaxonomiesTable.id})::int`,
        })
        .from(termTaxonomiesTable)
        .groupBy(termTaxonomiesTable.taxonomy)
        .orderBy(asc(termTaxonomiesTable.taxonomy)),
    );
  };

  const editTaxonomy = async (siteId: string, taxonomy: string, input?: CoreApiInvokeInput) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    const key = normalizeTaxonomyKey(taxonomy);
    if (!key) throw new Error("taxonomy key is required");
    const command = parseCommandInput(input);
    const renameTo = normalizeTaxonomyKey(command.rename || command.key || "");
    const name = String(command.name || command.label || "").trim();
    if (renameTo && renameTo !== key) {
      await withSiteTaxonomyScope(resolvedSiteId, async ({ termTaxonomiesTable }) => {
        await db
          .update(termTaxonomiesTable)
          .set({ taxonomy: renameTo })
          .where(eq(termTaxonomiesTable.taxonomy, key));
      });
      return { ok: true, taxonomy: renameTo, action: "rename" as const };
    }
    if (name) {
      await setSiteTextSetting(resolvedSiteId, `taxonomy_label_${key}`, name);
      return { ok: true, taxonomy: key, action: "label" as const };
    }
    return { ok: true, taxonomy: key, action: "noop" as const };
  };

  const listTaxonomyTerms = async (siteId: string, taxonomy: string) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    const key = normalizeTaxonomyKey(taxonomy);
    return withSiteTaxonomyScope(resolvedSiteId, async ({ termsTable, termTaxonomiesTable }) =>
      db
        .select({
          id: termTaxonomiesTable.id,
          taxonomy: termTaxonomiesTable.taxonomy,
          name: termsTable.name,
          slug: termsTable.slug,
          parentId: termTaxonomiesTable.parentId,
        })
        .from(termTaxonomiesTable)
        .innerJoin(termsTable, eq(termsTable.id, termTaxonomiesTable.termId))
        .where(eq(termTaxonomiesTable.taxonomy, key))
        .orderBy(asc(termsTable.name)),
    );
  };

  const listPostTaxonomyAssignments = async (siteId: string, dataDomainKey: string, postId: string) => {
    const domainKey = normalizeTaxonomyKey(dataDomainKey);
    const normalizedSiteId = String(siteId || "").trim();
    const normalizedPostId = String(postId || "").trim();
    if (!domainKey || !normalizedPostId) return [];
    const post = await getSiteDomainPostById({
      siteId: normalizedSiteId,
      postId: normalizedPostId,
      dataDomainKey: domainKey,
    });
    if (!post) return [];
    return withSiteTaxonomyScope(
      normalizedSiteId,
      async ({ termRelationshipsTable, termTaxonomiesTable, termsTable, termTaxonomyDomainsTable }) =>
        db
          .select({
            taxonomy: termTaxonomiesTable.taxonomy,
            termTaxonomyId: termTaxonomiesTable.id,
            termId: termsTable.id,
            slug: termsTable.slug,
            name: termsTable.name,
          })
          .from(termRelationshipsTable)
          .innerJoin(termTaxonomiesTable, eq(termTaxonomiesTable.id, termRelationshipsTable.termTaxonomyId))
          .innerJoin(termsTable, eq(termsTable.id, termTaxonomiesTable.termId))
          .innerJoin(termTaxonomyDomainsTable, eq(termTaxonomyDomainsTable.termTaxonomyId, termTaxonomiesTable.id))
          .where(
            and(
              eq(termRelationshipsTable.objectId, normalizedPostId),
              eq(termTaxonomyDomainsTable.dataDomainId, post.dataDomainId),
            ),
          )
          .orderBy(asc(termTaxonomiesTable.taxonomy), asc(termsTable.name)),
    );
  };

  const editTaxonomyTerm = async (siteId: string, taxonomy: string, termTaxonomyId: number, input?: CoreApiInvokeInput) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    const key = normalizeTaxonomyKey(taxonomy);
    const command = parseCommandInput(input);
    const name = String(command.name || "").trim();
    const slug = String(command.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    await withSiteTaxonomyScope(resolvedSiteId, async ({ termsTable, termTaxonomiesTable }) => {
      const [row] = await db
        .select({
          taxonomy: termTaxonomiesTable.taxonomy,
          termId: termTaxonomiesTable.termId,
        })
        .from(termTaxonomiesTable)
        .where(eq(termTaxonomiesTable.id, termTaxonomyId))
        .limit(1);
      if (!row || row.taxonomy !== key) throw new Error("Term taxonomy not found.");

      if (name || slug) {
        await db
          .update(termsTable)
          .set({
            ...(name ? { name } : {}),
            ...(slug ? { slug } : {}),
            updatedAt: new Date(),
          })
          .where(eq(termsTable.id, row.termId));
      }
    });

    return { ok: true, taxonomy: key, termTaxonomyId };
  };

  const getTaxonomyTermMeta = async (siteId: string, termTaxonomyId: number) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    return withSiteTaxonomyScope(resolvedSiteId, async ({ termTaxonomiesTable, termTaxonomyMetaTable }) => {
      const [taxonomyRow] = await db
        .select({ id: termTaxonomiesTable.id })
        .from(termTaxonomiesTable)
        .where(eq(termTaxonomiesTable.id, Math.trunc(termTaxonomyId)))
        .limit(1);
      if (!taxonomyRow) return [];
      return db
        .select({
          key: termTaxonomyMetaTable.key,
          value: termTaxonomyMetaTable.value,
        })
        .from(termTaxonomyMetaTable)
        .where(eq(termTaxonomyMetaTable.termTaxonomyId, Math.trunc(termTaxonomyId)))
        .orderBy(asc(termTaxonomyMetaTable.key));
    });
  };

  const setTaxonomyTermMeta = async (siteId: string, termTaxonomyId: number, key: string, value: string) => {
    const resolvedSiteId = resolveTaxonomySiteId(siteId);
    const metaKey = normalizeMetaKey(key);
    if (!metaKey) throw new Error("meta key is required");
    await withSiteTaxonomyScope(resolvedSiteId, async ({ termTaxonomiesTable, termTaxonomyMetaTable }) => {
      const [taxonomyRow] = await db
        .select({ id: termTaxonomiesTable.id })
        .from(termTaxonomiesTable)
        .where(eq(termTaxonomiesTable.id, Math.trunc(termTaxonomyId)))
        .limit(1);
      if (!taxonomyRow) throw new Error("Term taxonomy not found.");
      await db
        .insert(termTaxonomyMetaTable)
        .values({
          termTaxonomyId: Math.trunc(termTaxonomyId),
          key: metaKey,
          value: String(value ?? ""),
        })
        .onConflictDoUpdate({
          target: [termTaxonomyMetaTable.termTaxonomyId, termTaxonomyMetaTable.key],
          set: { value: String(value ?? ""), updatedAt: new Date() },
        });
    });
    return { ok: true };
  };

  const resolveMenuSiteId = (siteId?: string) => {
    const resolved = String(siteId || options?.siteId || "").trim();
    if (!resolved) {
      throw new Error(`[plugin-guard] Plugin "${pluginName}" menu API requires a bound site or explicit siteId.`);
    }
    return resolved;
  };

  const requireMenuWriteCapability = () => {
    requireCapability("adminExtensions", "core.menus.write()");
  };

  const menuApi = {
    list: async (siteId?: string) => listCoreMenus(resolveMenuSiteId(siteId)),
    get: async (siteId: string, menuKey: string) => getCoreMenuByKey(resolveMenuSiteId(siteId), menuKey),
    byLocation: async (siteId: string, location: string) => {
      const normalized = normalizeCoreMenuLocation(location);
      if (!normalized) throw new Error("Invalid menu location.");
      return getCoreMenuByLocation(resolveMenuSiteId(siteId), normalized);
    },
    create: async (siteId: string, input: UpsertMenuInput) => {
      requireMenuWriteCapability();
      return createCoreMenu(resolveMenuSiteId(siteId), input);
    },
    update: async (siteId: string, menuKey: string, input: UpsertMenuInput) => {
      requireMenuWriteCapability();
      return updateCoreMenuByKey(resolveMenuSiteId(siteId), menuKey, input);
    },
    delete: async (siteId: string, menuKey: string) => {
      requireMenuWriteCapability();
      return deleteCoreMenuByKey(resolveMenuSiteId(siteId), menuKey);
    },
    items: {
      list: async (siteId: string, menuKey: string) => listCoreMenuItems(resolveMenuSiteId(siteId), menuKey),
      get: async (siteId: string, menuKey: string, itemId: string) =>
        getCoreMenuItem(resolveMenuSiteId(siteId), menuKey, itemId),
      create: async (siteId: string, menuKey: string, input: UpsertMenuItemInput) => {
        requireMenuWriteCapability();
        return createCoreMenuItem(resolveMenuSiteId(siteId), menuKey, input);
      },
      update: async (siteId: string, menuKey: string, itemId: string, input: UpsertMenuItemInput) => {
        requireMenuWriteCapability();
        return updateCoreMenuItem(resolveMenuSiteId(siteId), menuKey, itemId, input);
      },
      delete: async (siteId: string, menuKey: string, itemId: string) => {
        requireMenuWriteCapability();
        return deleteCoreMenuItem(resolveMenuSiteId(siteId), menuKey, itemId);
      },
    },
  };

  const core: CoreServiceApi = {
    async invoke(path, input) {
      const segments = String(path || "")
        .split(".")
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (segments[0]?.toLowerCase() === "core") segments.shift();

      let boundSiteId = "";
      if (segments[0]?.toLowerCase() === "siteid" || segments[0]?.toLowerCase() === "site") {
        segments.shift();
        boundSiteId = segments.shift() || "";
      }

      const service = (segments.shift() || "").toLowerCase();
      if (service === "taxonomy") {
        if ((segments[0] || "").toLowerCase() === "list") return listTaxonomies(boundSiteId);
        const taxonomy = segments.shift() || "";
        const next = (segments.shift() || "").toLowerCase();
        if (next === "edit") return editTaxonomy(boundSiteId, taxonomy, input);
        if (next === "terms" && (segments[0] || "").toLowerCase() === "list") {
          return listTaxonomyTerms(boundSiteId, taxonomy);
        }
        if (next === "term") {
          const termTaxonomyId = Math.trunc(Number(segments.shift() || "0"));
          const action = (segments.shift() || "").toLowerCase();
          if (action === "edit") return editTaxonomyTerm(boundSiteId, taxonomy, termTaxonomyId, input);
          if (action === "meta") {
            const op = (segments.shift() || "").toLowerCase();
            if (op === "get") return getTaxonomyTermMeta(boundSiteId, termTaxonomyId);
            if (op === "set") {
              const command = parseCommandInput(input);
              return setTaxonomyTermMeta(boundSiteId, termTaxonomyId, command.key || "value", command.value || "");
            }
          }
        }
      }
      if (service === "schedule") {
        const action = (segments.shift() || "").toLowerCase();
        if (action === "list") return listSchedules();
      }
      if (service === "profile") {
        const action = (segments.shift() || "read").toLowerCase();
        if (action === "read" || action === "get") return core.profile.read();
        if (action === "create") return core.profile.create(parseProfileInput(input));
        if (action === "edit" || action === "update") return core.profile.update(parseProfileInput(input));
      }
      if (service === "data-domain" || service === "datadomain") {
        if ((segments[0] || "").toLowerCase() === "list") return base.listDataDomains(boundSiteId || undefined);
        const domainKey = segments.shift() || "";
        const postId = segments.shift() || "";
        const action = (segments.shift() || "").toLowerCase();
        const op = (segments.shift() || "").toLowerCase();
        if (action === "taxonomy" && op === "list") {
          return listPostTaxonomyAssignments(boundSiteId, domainKey, postId);
        }
      }
      if (service === "content") {
        const area = (segments.shift() || "").toLowerCase();
        if (area === "post" || area === "posts") {
          const dataDomainKey = segments.shift() || "";
          const postId = segments.shift() || "";
          const action = (segments.shift() || (postId ? "get" : "list")).toLowerCase();
          if (action === "get" && postId) {
            return pluginContentPostApi.get(boundSiteId, dataDomainKey, postId);
          }
          if (action === "list" || (!postId && (action === "" || action === "get"))) {
            const command = parseCommandInput(input);
            return pluginContentPostApi.list(boundSiteId, dataDomainKey, {
              ids: Array.isArray(command.ids) ? command.ids.map((entry) => String(entry || "").trim()).filter(Boolean) : undefined,
              published: typeof command.published === "boolean" ? command.published : undefined,
              includeContent: typeof command.includeContent === "boolean" ? command.includeContent : undefined,
              limit: Number.isFinite(Number(command.limit)) ? Number(command.limit) : undefined,
            });
          }
        }
        if (area === "meta") {
          const dataDomainKey = segments.shift() || "";
          const postId = segments.shift() || "";
          const action = (segments.shift() || "read").toLowerCase();
          if (action === "read" || action === "get" || action === "list") {
            const command = parseCommandInput(input);
            return pluginContentMetaApi.read(boundSiteId, dataDomainKey, postId, command.key || "");
          }
          if (action === "set" || action === "update") {
            const command = parseCommandInput(input);
            return pluginContentMetaApi.set(
              boundSiteId,
              dataDomainKey,
              postId,
              command.key || "",
              command.value || "",
            );
          }
          if (action === "delete" || action === "remove") {
            const command = parseCommandInput(input);
            return pluginContentMetaApi.delete(boundSiteId, dataDomainKey, postId, command.key || "");
          }
        }
        if (area === "hiddenmeta" || area === "hidden-meta") {
          const dataDomainKey = segments.shift() || "";
          const postId = segments.shift() || "";
          const action = (segments.shift() || "read").toLowerCase();
          if (action === "read" || action === "get" || action === "list") {
            const command = parseCommandInput(input);
            return pluginHiddenMetaApi.read(boundSiteId, dataDomainKey, postId, command.key || "");
          }
          if (action === "set" || action === "update") {
            const command = parseCommandInput(input);
            return pluginHiddenMetaApi.set(
              boundSiteId,
              dataDomainKey,
              postId,
              command.key || "",
              command.value || "",
            );
          }
          if (action === "delete" || action === "remove") {
            const command = parseCommandInput(input);
            return pluginHiddenMetaApi.delete(boundSiteId, dataDomainKey, postId, command.key || "");
          }
        }
      }
      if (service === "menu" || service === "menus") {
        const firstSegment = segments.shift() || "";
        const firstAction = firstSegment.toLowerCase();
        if (firstAction === "list") return menuApi.list(boundSiteId);
        if (firstAction === "add" || firstAction === "create") {
          return menuApi.create(boundSiteId, parseMenuInput(input));
        }
        if (firstAction === "location") {
          const location = segments.shift() || "";
          return menuApi.byLocation(boundSiteId, location);
        }
        const menuKey = firstSegment;
        const action = (segments.shift() || "get").toLowerCase();
        if (action === "get") return menuApi.get(boundSiteId, menuKey);
        if (action === "edit" || action === "update") {
          return menuApi.update(boundSiteId, menuKey, parseMenuInput(input));
        }
        if (action === "delete" || action === "remove") return menuApi.delete(boundSiteId, menuKey);
        if (action === "item" || action === "items") {
          const nextSegment = segments.shift() || "";
          const nextAction = nextSegment.toLowerCase();
          if (!nextSegment || nextAction === "list") return menuApi.items.list(boundSiteId, menuKey);
          if (nextAction === "add" || nextAction === "create") {
            return menuApi.items.create(boundSiteId, menuKey, parseMenuItemInput(input));
          }
          const itemId = nextSegment;
          const itemAction = (segments.shift() || "get").toLowerCase();
          if (itemAction === "get") return menuApi.items.get(boundSiteId, menuKey, itemId);
          if (itemAction === "edit" || itemAction === "update") {
            return menuApi.items.update(boundSiteId, menuKey, itemId, parseMenuItemInput(input));
          }
          if (itemAction === "delete" || itemAction === "remove") {
            return menuApi.items.delete(boundSiteId, menuKey, itemId);
          }
        }
      }
      throw new Error(`Unknown core route: ${path}`);
    },
    forSite(siteId: string) {
      const bound = String(siteId || "").trim();
      return {
        invoke: (path: string, input?: CoreApiInvokeInput) => core.invoke(`siteId.${bound}.${path}`, input),
        content: {
          post: {
            get: (dataDomainKey: string, postId: string) => pluginContentPostApi.get(bound, dataDomainKey, postId),
            list: (dataDomainKey: string, input) => pluginContentPostApi.list(bound, dataDomainKey, input),
          },
          meta: {
            read: (dataDomainKey: string, postId: string, key?: string) =>
              pluginContentMetaApi.read(bound, dataDomainKey, postId, key),
            set: (dataDomainKey: string, postId: string, key: string, value: string) =>
              pluginContentMetaApi.set(bound, dataDomainKey, postId, key, value),
            delete: (dataDomainKey: string, postId: string, key: string) =>
              pluginContentMetaApi.delete(bound, dataDomainKey, postId, key),
          },
          hiddenMeta: {
            read: (dataDomainKey: string, postId: string, key?: string) =>
              pluginHiddenMetaApi.read(bound, dataDomainKey, postId, key),
            set: (dataDomainKey: string, postId: string, key: string, value: string) =>
              pluginHiddenMetaApi.set(bound, dataDomainKey, postId, key, value),
            delete: (dataDomainKey: string, postId: string, key: string) =>
              pluginHiddenMetaApi.delete(bound, dataDomainKey, postId, key),
          },
        },
        menus: {
          list: () => menuApi.list(bound),
          get: (menuKey: string) => menuApi.get(bound, menuKey),
          byLocation: (location: string) => menuApi.byLocation(bound, location),
          create: (input: UpsertMenuInput) => menuApi.create(bound, input),
          update: (menuKey: string, input: UpsertMenuInput) => menuApi.update(bound, menuKey, input),
          delete: (menuKey: string) => menuApi.delete(bound, menuKey),
          items: {
            list: (menuKey: string) => menuApi.items.list(bound, menuKey),
            get: (menuKey: string, itemId: string) => menuApi.items.get(bound, menuKey, itemId),
            create: (menuKey: string, input: UpsertMenuItemInput) => menuApi.items.create(bound, menuKey, input),
            update: (menuKey: string, itemId: string, input: UpsertMenuItemInput) =>
              menuApi.items.update(bound, menuKey, itemId, input),
            delete: (menuKey: string, itemId: string) => menuApi.items.delete(bound, menuKey, itemId),
          },
        },
        taxonomy: {
          list: () => core.invoke(`siteId.${bound}.taxonomy.list`) as Promise<Array<{ key: string; termCount: number }>>,
          terms: {
            list: (taxonomy: string) =>
              core.invoke(`siteId.${bound}.taxonomy.${taxonomy}.terms.list`) as Promise<
                Array<{ id: number; taxonomy: string; name: string; slug: string; parentId: number | null }>
              >,
          },
          edit: (taxonomy: string, input?: CoreApiInvokeInput) =>
            core.invoke(`siteId.${bound}.taxonomy.${taxonomy}.edit`, input) as Promise<{
              ok: boolean;
              taxonomy: string;
              action: string;
            }>,
        },
        dataDomain: {
          list: () => core.invoke(`siteId.${bound}.data-domain.list`) as Promise<any[]>,
          postTaxonomyList: (dataDomainKey: string, postId: string) =>
            core.invoke(`siteId.${bound}.data-domain.${dataDomainKey}.${postId}.taxonomy.list`) as Promise<
              Array<{ taxonomy: string; termTaxonomyId: number; termId: number; slug: string; name: string }>
            >,
        },
      };
    },
    site: {
      get: (siteId: string) => base.getSiteById(siteId),
    },
    profile: {
      create: async (input) => {
        const session = await getSession();
        const userId = String(session?.user?.id || "").trim();
        if (!userId) throw new Error("Not authenticated");
        return createCoreProfile(userId, input || {});
      },
      read: async () => {
        const session = await getSession();
        const userId = String(session?.user?.id || "").trim();
        if (!userId) throw new Error("Not authenticated");
        return readCoreProfile(userId);
      },
      update: async (input) => {
        const session = await getSession();
        const userId = String(session?.user?.id || "").trim();
        if (!userId) throw new Error("Not authenticated");
        return updateCoreProfile(userId, input || {});
      },
    },
    settings: {
      get: (key: string, fallback = "") => base.getSetting(key, fallback),
      set: (key: string, value: string) => setSetting(key, value),
    },
    dataDomain: {
      list: (siteId?: string) => base.listDataDomains(siteId),
    },
    content: {
      post: pluginContentPostApi,
      meta: pluginContentMetaApi,
      hiddenMeta: pluginHiddenMetaApi,
    },
    menus: menuApi,
    taxonomy: {
      list: () => listTaxonomies(options?.siteId),
      edit: (taxonomy: string, input?: CoreApiInvokeInput) => editTaxonomy(options?.siteId || "", taxonomy, input),
      terms: {
        list: (taxonomy: string) => listTaxonomyTerms(options?.siteId || "", taxonomy),
        meta: {
          get: (termTaxonomyId: number) => getTaxonomyTermMeta(options?.siteId || "", termTaxonomyId),
          set: (termTaxonomyId: number, key: string, value: string) =>
            setTaxonomyTermMeta(options?.siteId || "", termTaxonomyId, key, value),
        },
      },
    },
    schedule: {
      create: createSchedule,
      list: listSchedules,
      update: updateSchedule,
      delete: deleteSchedule,
    },
    messaging: {
      send: sendCommunication,
      retryPending: retryPendingCommunications,
      purge: purgeCommunicationQueue,
    },
    comments: {
      getPublicCapabilities: (siteId: string) => getPublicCommentCapabilities(siteId),
      createTableBackedProvider: (input?: Partial<PluginCommentProviderRegistration>) => {
        const boundSiteId = options?.siteId;
        if (!boundSiteId) {
          throw new Error("[plugin-guard] core.comments.createTableBackedProvider() requires a bound site plugin context.");
        }
        return createTableBackedCommentProvider(boundSiteId, input || {});
      },
      create: createComment,
      list: listComments,
      update: updateComment,
      delete: deleteComment,
      moderate: moderateComment,
      listForExport: listCommentsForExport,
    },
    webcallbacks: {
      dispatch: dispatchWebcallback,
      listRecent: listRecentWebcallbackEvents,
      purge: purgeWebcallbackEvents,
    },
    webhooks: {
      subscriptions: {
        list: listWebhookSubscriptions,
        upsert: upsertWebhookSubscription,
        delete: deleteWebhookSubscription,
      },
      deliveries: {
        retryPending: retryPendingWebhookDeliveries,
      },
    },
  };

  return {
    ...base,
    core,
    setSetting,
    setPluginSetting,
    registerContentType,
    registerAuthProvider,
    registerScheduleHandler,
    registerCommunicationProvider,
    registerCommentProvider,
    registerWebcallbackHandler,
    registerContentState,
    registerContentTransition,
    createSchedule,
    listSchedules,
    updateSchedule,
    deleteSchedule,
  };
}

function throwThemeSideEffectError(action: string): never {
  throw new Error(`[theme-guard] Themes cannot call side-effect API: ${action}. Use Core contracts instead.`);
}

export function createThemeExtensionApi(themeId?: string): ThemeExtensionApi {
  const base = createReadBaseApi(undefined);
  const boundThemeId = String(themeId || "").trim();
  const requireThemeOwner = () => {
    if (!boundThemeId) {
      throw new Error("[theme-guard] Theme scheduler API requires a bound theme id.");
    }
  };
  return {
    ...base,
    core: {
      site: {
        get: (siteId: string) => base.getSiteById(siteId),
      },
      profile: {
        create: async () => throwThemeSideEffectError("core.profile.create"),
        read: async () => {
          const session = await getSession();
          const userId = String(session?.user?.id || "").trim();
          if (!userId) return null;
          return readCoreProfile(userId);
        },
        update: async () => throwThemeSideEffectError("core.profile.update"),
      },
      settings: {
        get: (key: string, fallback = "") => base.getSetting(key, fallback),
        set: async () => throwThemeSideEffectError("core.settings.set"),
      },
      dataDomain: {
        list: (siteId?: string) => base.listDataDomains(siteId),
      },
      content: {
        post: {
          get: async (siteId: string, dataDomainKey: string, postId: string) => {
            const normalizedSiteId = String(siteId || "").trim();
            const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
            const normalizedPostId = String(postId || "").trim();
            if (!normalizedSiteId || !normalizedDomainKey || !normalizedPostId) return null;
            return formatCoreContentPostRecord(
              await getSiteDomainPostById({
                siteId: normalizedSiteId,
                dataDomainKey: normalizedDomainKey,
                postId: normalizedPostId,
              }),
            );
          },
          list: async (siteId: string, dataDomainKey: string, input) => {
            const normalizedSiteId = String(siteId || "").trim();
            const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
            if (!normalizedSiteId || !normalizedDomainKey) return [];
            const rows = await listSiteDomainPosts({
              siteId: normalizedSiteId,
              dataDomainKey: normalizedDomainKey,
              includeInactiveDomains: true,
              includeContent: Boolean(input?.includeContent),
              published: typeof input?.published === "boolean" ? input.published : undefined,
              ids: Array.isArray(input?.ids)
                ? input.ids.map((entry) => String(entry || "").trim()).filter(Boolean)
                : undefined,
              limit: Number.isFinite(Number(input?.limit))
                ? Math.max(1, Math.trunc(Number(input?.limit)))
                : undefined,
            });
            return rows
              .map((row) => formatCoreContentPostRecord(row))
              .filter((row): row is CoreContentPostRecord => Boolean(row));
          },
        },
        meta: {
          read: async (siteId: string, dataDomainKey: string, postId: string, key?: string) => {
            const normalizedSiteId = String(siteId || "").trim();
            const normalizedDomainKey = normalizeTaxonomyKey(dataDomainKey);
            const normalizedPostId = String(postId || "").trim();
            if (!normalizedSiteId || !normalizedDomainKey || !normalizedPostId) return [];
            const post = await getSiteDomainPostById({
              siteId: normalizedSiteId,
              dataDomainKey: normalizedDomainKey,
              postId: normalizedPostId,
            });
            if (!post) return [];
            const entries = await listSiteDomainPostMeta({
              siteId: normalizedSiteId,
              dataDomainKey: normalizedDomainKey,
              postId: normalizedPostId,
            });
            return normalizeContentMetaEntries(entries, key);
          },
        },
      },
      menus: {
        list: (siteId?: string) => {
          const resolvedSiteId = String(siteId || "").trim();
          if (!resolvedSiteId) throw new Error("[theme-guard] core.menus.list requires a site id.");
          return listCoreMenus(resolvedSiteId);
        },
        get: (siteId: string, menuKey: string) => getCoreMenuByKey(siteId, menuKey),
        byLocation: (siteId: string, location: string) => {
          const normalized = normalizeCoreMenuLocation(location);
          if (!normalized) throw new Error("Invalid menu location.");
          return getCoreMenuByLocation(siteId, normalized);
        },
        create: async () => throwThemeSideEffectError("core.menus.create"),
        update: async () => throwThemeSideEffectError("core.menus.update"),
        delete: async () => throwThemeSideEffectError("core.menus.delete"),
        items: {
          list: (siteId: string, menuKey: string) => listCoreMenuItems(siteId, menuKey),
          get: (siteId: string, menuKey: string, itemId: string) => getCoreMenuItem(siteId, menuKey, itemId),
          create: async () => throwThemeSideEffectError("core.menus.items.create"),
          update: async () => throwThemeSideEffectError("core.menus.items.update"),
          delete: async () => throwThemeSideEffectError("core.menus.items.delete"),
        },
      },
      taxonomy: {
        list: async () => [],
        edit: async () => throwThemeSideEffectError("core.taxonomy.edit"),
        terms: {
          list: async () => [],
          meta: {
            get: async () => [],
            set: async () => throwThemeSideEffectError("core.taxonomy.terms.meta.set"),
          },
        },
      },
    },
    async setSetting() {
      return throwThemeSideEffectError("setSetting");
    },
    async setPluginSetting() {
      return throwThemeSideEffectError("setPluginSetting");
    },
    async createSchedule(input) {
      requireThemeOwner();
      return createScheduleEntry("theme", boundThemeId, {
        siteId: input.siteId || null,
        name: input.name,
        actionKey: input.actionKey,
        payload: input.payload || {},
        enabled: input.enabled ?? true,
        runEveryMinutes: input.runEveryMinutes ?? 60,
        nextRunAt: input.nextRunAt,
      } as any);
    },
    async listSchedules() {
      requireThemeOwner();
      return listScheduleEntries({ ownerType: "theme", ownerId: boundThemeId, includeDisabled: true });
    },
    async updateSchedule(scheduleId, input) {
      requireThemeOwner();
      return updateScheduleEntry(scheduleId, {
        siteId: input.siteId === undefined ? undefined : input.siteId || null,
        name: input.name,
        actionKey: input.actionKey,
        payload: input.payload,
        enabled: input.enabled,
        runEveryMinutes: input.runEveryMinutes,
        nextRunAt: input.nextRunAt,
      } as any, {
        isAdmin: false,
        ownerType: "theme",
        ownerId: boundThemeId,
      });
    },
    async deleteSchedule(scheduleId) {
      requireThemeOwner();
      await deleteScheduleEntry(scheduleId, {
        isAdmin: false,
        ownerType: "theme",
        ownerId: boundThemeId,
      });
    },
  };
}

// Backward-compatible alias for plugin runtime call sites.
export const createExtensionApi = createPluginExtensionApi;

export async function getThemeContextApi(
  siteId: string,
  queryRequests: ThemeQueryRequest[] = [],
  actor: { userId?: string | null } = {},
) {
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
  const [
    siteUrl,
    seoMetaTitle,
    seoMetaDescription,
    publicPluginSettingsAllowlist,
    headerMenu,
    footerMenu,
    dashboardMenu,
    headerMenuDefinition,
    footerMenuDefinition,
    dashboardMenuDefinition,
  ] = await Promise.all([
    getSettingByKey("site_url"),
    getSettingByKey("seo_meta_title"),
    getSettingByKey("seo_meta_description"),
    getSettingByKey("theme_public_plugin_setting_keys"),
    getCoreMenuByLocation(siteId, "header"),
    getCoreMenuByLocation(siteId, "footer"),
    getCoreMenuByLocation(siteId, "dashboard"),
    getCoreMenuDefinitionByLocation(siteId, "header"),
    getCoreMenuDefinitionByLocation(siteId, "footer"),
    getCoreMenuDefinitionByLocation(siteId, "dashboard"),
  ]);
  const allowedPluginSettingKeys = String(publicPluginSettingsAllowlist ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("plugin_"));
  const pluginSettings = allowedPluginSettingKeys.length
    ? await getSettingsByKeys(allowedPluginSettingKeys)
    : {};
  const query = await runThemeQueries(siteId, queryRequests, actor);

  return {
    site,
    settings: {
      siteUrl,
      seoMetaTitle,
      seoMetaDescription,
    },
    domains,
    menus: {
      header: headerMenu,
      footer: footerMenu,
      dashboard: dashboardMenu,
    },
    menuLocations: {
      header: headerMenuDefinition,
      footer: footerMenuDefinition,
      dashboard: dashboardMenuDefinition,
    },
    pluginSettings,
    query,
  };
}
