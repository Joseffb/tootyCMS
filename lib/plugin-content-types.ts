import type { PluginContentTypeRegistration } from "@/lib/kernel";
import {
  ensureSiteDomainTypeTables,
  siteDomainTypeMetaTableTemplate,
  siteDomainTypeTableTemplate,
} from "@/lib/site-domain-type-tables";
import {
  findSiteDataDomainByKey,
  setSiteDataDomainActivation,
  upsertSiteDataDomain,
} from "@/lib/site-data-domain-registry";

const pluginContentTypeSyncCache = new Map<string, string>();
const pluginContentTypeSyncInFlight = new Map<string, Promise<void>>();

function normalizeDomainKey(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function normalizeLabel(raw: string, fallbackKey: string) {
  const value = String(raw || "").trim();
  if (value) return value;
  const spaced = fallbackKey.replace(/[-_]+/g, " ").trim();
  if (!spaced) return "Content";
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeShowInMenu(value: unknown) {
  return value !== false;
}

function normalizeMetaKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 80);
}

function normalizeWorkflowStates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeDomainKey(String(entry ?? "")))
        .filter(Boolean),
    ),
  );
}

function normalizeMediaFieldKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeMetaKey(entry))
        .filter(Boolean),
    ),
  );
}

function buildRegistrationSignature(registrations: PluginContentTypeRegistration[]) {
  return JSON.stringify(
    (registrations || []).map((registration) => ({
      key: normalizeDomainKey(registration.key),
      label: normalizeLabel(registration.label || "", normalizeDomainKey(registration.key)),
      description: String(registration.description || "").trim(),
      showInMenu: normalizeShowInMenu(registration.showInMenu),
      parentKey: normalizeDomainKey(registration.parentKey || ""),
      parentMetaKey: normalizeMetaKey(registration.parentMetaKey),
      embedHandleMetaKey: normalizeMetaKey(registration.embedHandleMetaKey),
      workflowStates: normalizeWorkflowStates(registration.workflowStates),
      mediaFieldKeys: normalizeMediaFieldKeys(registration.mediaFieldKeys),
    })),
  );
}

async function ensurePluginContentType(
  pluginId: string,
  registration: PluginContentTypeRegistration,
  siteId?: string,
) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) {
    // Domain registration is site-scoped in strict tenant table mode.
    return;
  }
  const key = normalizeDomainKey(registration.key);
  if (!key) return;

  const label = normalizeLabel(registration.label || "", key);
  const showInMenu = normalizeShowInMenu(registration.showInMenu);
  const parentKey = normalizeDomainKey(registration.parentKey || "");
  const parentMetaKey = normalizeMetaKey(registration.parentMetaKey);
  const embedHandleMetaKey = normalizeMetaKey(registration.embedHandleMetaKey);
  const workflowStates = normalizeWorkflowStates(registration.workflowStates);
  const mediaFieldKeys = normalizeMediaFieldKeys(registration.mediaFieldKeys);
  const existing = await findSiteDataDomainByKey(normalizedSiteId, key);
  const currentSettings =
    existing?.settings && typeof existing.settings === "object"
      ? (existing.settings as Record<string, unknown>)
      : {};
  const contentTable = siteDomainTypeTableTemplate(key);
  const metaTable = siteDomainTypeMetaTableTemplate(key);

  await upsertSiteDataDomain(normalizedSiteId, {
    key,
    label,
    contentTable,
    metaTable,
    description: String(registration.description || "").trim(),
    settings: {
      ...currentSettings,
      pluginOwner: pluginId,
      pluginManaged: true,
      storageModel: "site_domain_type_table",
      showInMenu,
      ...(parentKey ? { parentKey } : {}),
      ...(parentMetaKey ? { parentMetaKey } : {}),
      ...(embedHandleMetaKey ? { embedHandleMetaKey } : {}),
      ...(workflowStates.length ? { workflowStates } : {}),
      ...(mediaFieldKeys.length ? { mediaFieldKeys } : {}),
    },
    isActive: true,
  });

  await setSiteDataDomainActivation(normalizedSiteId, key, true);
  await ensureSiteDomainTypeTables(normalizedSiteId, key);
}

export async function syncPluginContentTypes(
  pluginId: string,
  registrations: PluginContentTypeRegistration[],
  siteId?: string,
) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return;
  const syncKey = `${normalizedSiteId}:${pluginId}`;
  const nextSignature = buildRegistrationSignature(registrations);
  if (pluginContentTypeSyncCache.get(syncKey) === nextSignature) return;

  const pending = pluginContentTypeSyncInFlight.get(syncKey);
  if (pending) {
    await pending;
    if (pluginContentTypeSyncCache.get(syncKey) === nextSignature) return;
  }

  const run = (async () => {
    for (const registration of registrations) {
      await ensurePluginContentType(pluginId, registration, normalizedSiteId);
    }
    pluginContentTypeSyncCache.set(syncKey, nextSignature);
  })();

  pluginContentTypeSyncInFlight.set(syncKey, run);
  try {
    await run;
  } finally {
    pluginContentTypeSyncInFlight.delete(syncKey);
  }
}

export async function getPluginOwnerForDataDomain(siteId: string | undefined, dataDomainKey: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return "";
  const key = normalizeDomainKey(dataDomainKey);
  if (!key) return "";
  const row = await findSiteDataDomainByKey(normalizedSiteId, key);
  const settings = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  return String(settings.pluginOwner || "").trim().toLowerCase();
}

export async function isPluginManagedDataDomain(siteId: string, dataDomainKey: string) {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return false;
  const key = normalizeDomainKey(dataDomainKey);
  if (!key) return false;
  const row = await findSiteDataDomainByKey(normalizedSiteId, key);
  if (!row) return false;
  const settings = row.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  return Boolean(String(settings.pluginOwner || "").trim()) && row.isActive !== false;
}
