import db from "@/lib/db";
import { dataDomains, siteDataDomains } from "@/lib/schema";
import type { PluginContentTypeRegistration } from "@/lib/kernel";
import { and, eq, sql } from "drizzle-orm";

function normalizePrefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

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

async function ensurePluginContentType(
  pluginId: string,
  registration: PluginContentTypeRegistration,
  siteId?: string,
) {
  const key = normalizeDomainKey(registration.key);
  if (!key) return;

  const label = normalizeLabel(registration.label || "", key);
  const showInMenu = normalizeShowInMenu(registration.showInMenu);
  const parentKey = normalizeDomainKey(registration.parentKey || "");
  const parentMetaKey = normalizeMetaKey(registration.parentMetaKey);
  const embedHandleMetaKey = normalizeMetaKey(registration.embedHandleMetaKey);
  const workflowStates = normalizeWorkflowStates(registration.workflowStates);
  const mediaFieldKeys = normalizeMediaFieldKeys(registration.mediaFieldKeys);
  let existing = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, key),
    columns: {
      id: true,
      key: true,
      contentTable: true,
      metaTable: true,
      settings: true,
    },
  });

  if (!existing) {
    const prefix = normalizePrefix();
    const contentTable = `${prefix}site_domain_posts`;
    const metaTable = `${prefix}site_domain_post_meta`;

    await db.transaction(async (tx) => {
      const createdRows = await tx
        .insert(dataDomains)
        .values({
          key,
          label,
          contentTable,
          metaTable,
          description: String(registration.description || "").trim(),
          settings: {
            pluginOwner: pluginId,
            pluginManaged: true,
            storageModel: "shared_site_domain_posts",
            showInMenu,
            ...(parentKey ? { parentKey } : {}),
            ...(parentMetaKey ? { parentMetaKey } : {}),
            ...(embedHandleMetaKey ? { embedHandleMetaKey } : {}),
            ...(workflowStates.length ? { workflowStates } : {}),
            ...(mediaFieldKeys.length ? { mediaFieldKeys } : {}),
          },
        })
        .onConflictDoNothing()
        .returning({
          id: dataDomains.id,
          key: dataDomains.key,
          contentTable: dataDomains.contentTable,
          metaTable: dataDomains.metaTable,
          settings: dataDomains.settings,
        });

      existing =
        createdRows[0] ||
        (await tx.query.dataDomains.findFirst({
          where: eq(dataDomains.key, key),
          columns: {
            id: true,
            key: true,
            contentTable: true,
            metaTable: true,
            settings: true,
          },
        })) ||
        null;
    });
  } else {
    const currentSettings =
      existing.settings && typeof existing.settings === "object" ? (existing.settings as Record<string, unknown>) : {};
    if (
      currentSettings.pluginOwner !== pluginId ||
      currentSettings.pluginManaged !== true ||
      currentSettings.showInMenu !== showInMenu
    ) {
      await db
        .update(dataDomains)
        .set({
          contentTable: `${normalizePrefix()}site_domain_posts`,
          metaTable: `${normalizePrefix()}site_domain_post_meta`,
          settings: {
            ...currentSettings,
            pluginOwner: pluginId,
            pluginManaged: true,
            storageModel: "shared_site_domain_posts",
            showInMenu,
            ...(parentKey ? { parentKey } : {}),
            ...(parentMetaKey ? { parentMetaKey } : {}),
            ...(embedHandleMetaKey ? { embedHandleMetaKey } : {}),
            ...(workflowStates.length ? { workflowStates } : {}),
            ...(mediaFieldKeys.length ? { mediaFieldKeys } : {}),
          },
          description: String(registration.description || "").trim(),
        })
        .where(eq(dataDomains.id, existing.id));
    }
  }

  if (siteId && existing?.id) {
    const currentAssignment = await db.query.siteDataDomains.findFirst({
      where: and(eq(siteDataDomains.siteId, siteId), eq(siteDataDomains.dataDomainId, existing.id)),
      columns: {
        isActive: true,
      },
    });
    if (!currentAssignment) {
      await db.insert(siteDataDomains).values({
        siteId,
        dataDomainId: existing.id,
        isActive: true,
      });
    } else if (!currentAssignment.isActive) {
      await db
        .update(siteDataDomains)
        .set({
          isActive: true,
          updatedAt: new Date(),
        })
        .where(and(eq(siteDataDomains.siteId, siteId), eq(siteDataDomains.dataDomainId, existing.id)));
    }
  }
}

export async function syncPluginContentTypes(
  pluginId: string,
  registrations: PluginContentTypeRegistration[],
  siteId?: string,
) {
  for (const registration of registrations) {
    await ensurePluginContentType(pluginId, registration, siteId);
  }
}

export async function getPluginOwnerForDataDomain(dataDomainKey: string) {
  const key = normalizeDomainKey(dataDomainKey);
  if (!key) return "";
  const row = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, key),
    columns: {
      settings: true,
    },
  });
  const settings = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  return String(settings.pluginOwner || "").trim().toLowerCase();
}

export async function isPluginManagedDataDomain(siteId: string, dataDomainKey: string) {
  const key = normalizeDomainKey(dataDomainKey);
  if (!key) return false;
  const row = await db
    .select({
      id: dataDomains.id,
      pluginOwner: sql<string>`coalesce(${dataDomains.settings}->>'pluginOwner', '')`,
      siteId: siteDataDomains.siteId,
    })
    .from(dataDomains)
    .leftJoin(
      siteDataDomains,
      and(eq(siteDataDomains.dataDomainId, dataDomains.id), eq(siteDataDomains.siteId, siteId)),
    )
    .where(eq(dataDomains.key, key))
    .limit(1);

  if (!row[0]) return false;
  return Boolean(String(row[0].pluginOwner || "").trim()) && Boolean(row[0].siteId);
}
