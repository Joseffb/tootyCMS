import db from "@/lib/db";
import {
  domainPosts,
  dataDomains,
  siteDataDomains,
  sites,
  termRelationships,
  termTaxonomies,
  termTaxonomyMeta,
  terms,
} from "@/lib/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { runThemeQueries, type ThemeQueryRequest } from "@/lib/theme-query";
import { pluginConfigKey, sitePluginConfigKey } from "@/lib/plugins";
import { getSettingByKey, getSettingsByKeys, setSettingByKey } from "@/lib/settings-store";
import type {
  PluginCommentProviderRegistration,
  ContentStateRegistration,
  ContentTransitionRegistration,
  PluginAuthAdapterRegistration,
  PluginCommunicationProviderRegistration,
  PluginContentTypeRegistration,
  PluginScheduleHandlerRegistration,
  PluginServerHandlerRegistration,
  PluginWebcallbackHandlerRegistration,
} from "@/lib/kernel";
import { createScheduleEntry, deleteScheduleEntry, listScheduleEntries, updateScheduleEntry } from "@/lib/scheduler";
import { purgeCommunicationQueue, retryPendingCommunications, sendCommunication } from "@/lib/communications";
import {
  createComment,
  deleteComment,
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
  registerServerHandler: (registration: PluginServerHandlerRegistration) => void;
  registerAuthAdapter: (registration: PluginAuthAdapterRegistration) => void;
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
};

type CoreApiInvokeInput = string | Record<string, unknown> | undefined;

type BoundSiteCoreApi = {
  invoke: (path: string, input?: CoreApiInvokeInput) => Promise<unknown>;
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
  settings: {
    get: (key: string, fallback?: string) => Promise<string>;
    set: (key: string, value: string) => Promise<void>;
  };
  dataDomain: {
    list: (siteId?: string) => Promise<any[]>;
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

export type PluginExtensionApi = BaseExtensionApi & {
  core: CoreServiceApi;
  setSetting: (key: string, value: string) => Promise<void>;
  setPluginSetting: (key: string, value: string) => Promise<void>;
  registerContentType: (registration: PluginContentTypeRegistration) => void;
  registerServerHandler: (registration: PluginServerHandlerRegistration) => void;
  registerAuthAdapter: (registration: PluginAuthAdapterRegistration) => void;
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
  core: Pick<CoreServiceApi, "site" | "settings" | "dataDomain" | "taxonomy">;
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
  const base = createReadBaseApi(pluginId, options);
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

  const registerServerHandler: PluginExtensionApi["registerServerHandler"] = (registration) => {
      requireCapability("serverHandlers", "registerServerHandler()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerServerHandler() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerServerHandler(registration);
    };

  const registerAuthAdapter: PluginExtensionApi["registerAuthAdapter"] = (registration) => {
      requireCapability("authExtensions", "registerAuthAdapter()");
      if (!options?.coreRegistry) {
        throw new Error(
          `[plugin-guard] Plugin "${pluginName}" registerAuthAdapter() is unavailable outside Core runtime.`,
        );
      }
      options.coreRegistry.registerAuthAdapter(registration);
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

  const listTaxonomies = async () => {
    const rows = await db
      .select({
        key: termTaxonomies.taxonomy,
        termCount: sql<number>`count(${termTaxonomies.id})::int`,
      })
      .from(termTaxonomies)
      .groupBy(termTaxonomies.taxonomy)
      .orderBy(asc(termTaxonomies.taxonomy));
    return rows;
  };

  const editTaxonomy = async (taxonomy: string, input?: CoreApiInvokeInput) => {
    const key = normalizeTaxonomyKey(taxonomy);
    if (!key) throw new Error("taxonomy key is required");
    const command = parseCommandInput(input);
    const renameTo = normalizeTaxonomyKey(command.rename || command.key || "");
    const name = String(command.name || command.label || "").trim();
    if (renameTo && renameTo !== key) {
      await db.update(termTaxonomies).set({ taxonomy: renameTo }).where(eq(termTaxonomies.taxonomy, key));
      return { ok: true, taxonomy: renameTo, action: "rename" as const };
    }
    if (name) {
      await setSetting(`taxonomy_label_${key}`, name);
      return { ok: true, taxonomy: key, action: "label" as const };
    }
    return { ok: true, taxonomy: key, action: "noop" as const };
  };

  const listTaxonomyTerms = async (taxonomy: string) => {
    const key = normalizeTaxonomyKey(taxonomy);
    return db
      .select({
        id: termTaxonomies.id,
        taxonomy: termTaxonomies.taxonomy,
        name: terms.name,
        slug: terms.slug,
        parentId: termTaxonomies.parentId,
      })
      .from(termTaxonomies)
      .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
      .where(eq(termTaxonomies.taxonomy, key))
      .orderBy(asc(terms.name));
  };

  const listPostTaxonomyAssignments = async (siteId: string, dataDomainKey: string, postId: string) => {
    const domainKey = normalizeTaxonomyKey(dataDomainKey);
    const normalizedSiteId = String(siteId || "").trim();
    const normalizedPostId = String(postId || "").trim();
    if (!domainKey || !normalizedPostId) return [];

    return db
      .select({
        taxonomy: termTaxonomies.taxonomy,
        termTaxonomyId: termTaxonomies.id,
        termId: terms.id,
        slug: terms.slug,
        name: terms.name,
      })
      .from(termRelationships)
      .innerJoin(termTaxonomies, eq(termTaxonomies.id, termRelationships.termTaxonomyId))
      .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
      .innerJoin(domainPosts, eq(domainPosts.id, termRelationships.objectId))
      .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
      .where(
        and(
          eq(domainPosts.id, normalizedPostId),
          eq(dataDomains.key, domainKey),
          ...(normalizedSiteId ? [eq(domainPosts.siteId, normalizedSiteId)] : []),
        ),
      )
      .orderBy(asc(termTaxonomies.taxonomy), asc(terms.name));
  };

  const editTaxonomyTerm = async (taxonomy: string, termTaxonomyId: number, input?: CoreApiInvokeInput) => {
    const key = normalizeTaxonomyKey(taxonomy);
    const command = parseCommandInput(input);
    const [row] = await db
      .select({
        taxonomy: termTaxonomies.taxonomy,
        termId: termTaxonomies.termId,
      })
      .from(termTaxonomies)
      .where(eq(termTaxonomies.id, termTaxonomyId))
      .limit(1);
    if (!row || row.taxonomy !== key) throw new Error("Term taxonomy not found.");

    const name = String(command.name || "").trim();
    const slug = String(command.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (name || slug) {
      await db
        .update(terms)
        .set({
          ...(name ? { name } : {}),
          ...(slug ? { slug } : {}),
          updatedAt: new Date(),
        })
        .where(eq(terms.id, row.termId));
    }

    return { ok: true, taxonomy: key, termTaxonomyId };
  };

  const getTaxonomyTermMeta = async (termTaxonomyId: number) =>
    db
      .select({
        key: termTaxonomyMeta.key,
        value: termTaxonomyMeta.value,
      })
      .from(termTaxonomyMeta)
      .where(eq(termTaxonomyMeta.termTaxonomyId, Math.trunc(termTaxonomyId)))
      .orderBy(asc(termTaxonomyMeta.key));

  const setTaxonomyTermMeta = async (termTaxonomyId: number, key: string, value: string) => {
    const metaKey = normalizeMetaKey(key);
    if (!metaKey) throw new Error("meta key is required");
    await db
      .insert(termTaxonomyMeta)
      .values({
        termTaxonomyId: Math.trunc(termTaxonomyId),
        key: metaKey,
        value: String(value ?? ""),
      })
      .onConflictDoUpdate({
        target: [termTaxonomyMeta.termTaxonomyId, termTaxonomyMeta.key],
        set: { value: String(value ?? ""), updatedAt: new Date() },
      });
    return { ok: true };
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
        if ((segments[0] || "").toLowerCase() === "list") return listTaxonomies();
        const taxonomy = segments.shift() || "";
        const next = (segments.shift() || "").toLowerCase();
        if (next === "edit") return editTaxonomy(taxonomy, input);
        if (next === "terms" && (segments[0] || "").toLowerCase() === "list") {
          return listTaxonomyTerms(taxonomy);
        }
        if (next === "term") {
          const termTaxonomyId = Math.trunc(Number(segments.shift() || "0"));
          const action = (segments.shift() || "").toLowerCase();
          if (action === "edit") return editTaxonomyTerm(taxonomy, termTaxonomyId, input);
          if (action === "meta") {
            const op = (segments.shift() || "").toLowerCase();
            if (op === "get") return getTaxonomyTermMeta(termTaxonomyId);
            if (op === "set") {
              const command = parseCommandInput(input);
              return setTaxonomyTermMeta(termTaxonomyId, command.key || "value", command.value || "");
            }
          }
        }
      }
      if (service === "schedule") {
        const action = (segments.shift() || "").toLowerCase();
        if (action === "list") return listSchedules();
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
      throw new Error(`Unknown core route: ${path}`);
    },
    forSite(siteId: string) {
      const bound = String(siteId || "").trim();
      return {
        invoke: (path: string, input?: CoreApiInvokeInput) => core.invoke(`siteId.${bound}.${path}`, input),
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
    settings: {
      get: (key: string, fallback = "") => base.getSetting(key, fallback),
      set: (key: string, value: string) => setSetting(key, value),
    },
    dataDomain: {
      list: (siteId?: string) => base.listDataDomains(siteId),
    },
    taxonomy: {
      list: () => listTaxonomies(),
      edit: (taxonomy: string, input?: CoreApiInvokeInput) => editTaxonomy(taxonomy, input),
      terms: {
        list: (taxonomy: string) => listTaxonomyTerms(taxonomy),
        meta: {
          get: (termTaxonomyId: number) => getTaxonomyTermMeta(termTaxonomyId),
          set: (termTaxonomyId: number, key: string, value: string) => setTaxonomyTermMeta(termTaxonomyId, key, value),
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
    registerServerHandler,
    registerAuthAdapter,
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
      settings: {
        get: (key: string, fallback = "") => base.getSetting(key, fallback),
        set: async () => throwThemeSideEffectError("core.settings.set"),
      },
      dataDomain: {
        list: (siteId?: string) => base.listDataDomains(siteId),
      },
      taxonomy: {
        list: async () =>
          db
            .select({
              key: termTaxonomies.taxonomy,
              termCount: sql<number>`count(${termTaxonomies.id})::int`,
            })
            .from(termTaxonomies)
            .groupBy(termTaxonomies.taxonomy)
            .orderBy(asc(termTaxonomies.taxonomy)),
        edit: async () => throwThemeSideEffectError("core.taxonomy.edit"),
        terms: {
          list: async (taxonomy: string) =>
            db
              .select({
                id: termTaxonomies.id,
                taxonomy: termTaxonomies.taxonomy,
                name: terms.name,
                slug: terms.slug,
                parentId: termTaxonomies.parentId,
              })
              .from(termTaxonomies)
              .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
              .where(eq(termTaxonomies.taxonomy, normalizeTaxonomyKey(taxonomy)))
              .orderBy(asc(terms.name)),
          meta: {
            get: async (termTaxonomyId: number) =>
              db
                .select({
                  key: termTaxonomyMeta.key,
                  value: termTaxonomyMeta.value,
                })
                .from(termTaxonomyMeta)
                .where(eq(termTaxonomyMeta.termTaxonomyId, Math.trunc(termTaxonomyId)))
                .orderBy(asc(termTaxonomyMeta.key)),
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
  const [siteUrl, seoMetaTitle, seoMetaDescription, publicPluginSettingsAllowlist] = await Promise.all([
    getSettingByKey("site_url"),
    getSettingByKey("seo_meta_title"),
    getSettingByKey("seo_meta_description"),
    getSettingByKey("theme_public_plugin_setting_keys"),
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
    pluginSettings,
    query,
  };
}
