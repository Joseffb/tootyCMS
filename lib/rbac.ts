import { eq, sql } from "drizzle-orm";
import db from "@/lib/db";
import { getTextSetting, setTextSetting } from "@/lib/cms-config";
import { rbacRoles, siteUserTableRegistry, users } from "@/lib/schema";
import { getSiteUserRole } from "@/lib/site-user-tables";

export const NETWORK_ADMIN_ROLE = "network admin" as const;
export const USER_ROLES = ["administrator", "editor", "author"] as const;
export const SYSTEM_ROLES = [NETWORK_ADMIN_ROLE, ...USER_ROLES] as const;

export type UserRole = string;

export const SITE_CAPABILITIES = [
  "network.users.manage",
  "network.plugins.manage",
  "network.rbac.manage",
  "network.settings.read",
  "network.settings.write",
  "network.site.manage",
  "network.site.delete",
  "network.themes.manage",
  "site.plugins.manage",
  "site.themes.manage",
  "site.datadomain.manage",
  "site.seo.manage",
  "site.menus.manage",
  "site.settings.read",
  "site.settings.write",
  "site.users.manage",
  "site.domain.list",
  "site.content.read",
  "site.content.create",
  "site.content.edit.own",
  "site.content.edit.any",
  "site.content.delete.own",
  "site.content.delete.any",
  "site.content.publish",
  "site.taxonomy.manage",
  "site.media.create",
  "site.media.edit.own",
  "site.media.edit.any",
  "site.media.delete.own",
  "site.media.delete.any",
  "site.analytics.read",
] as const;

export type SiteCapability = (typeof SITE_CAPABILITIES)[number];
export type CapabilityMap = Record<SiteCapability, boolean>;
export type CapabilityMatrix = Record<string, CapabilityMap>;
const RBAC_CAPABILITY_MATRIX_KEY = "rbac_capability_matrix_v1";
const CAPABILITY_CACHE_TTL_MS = 5_000;

let rbacBootstrapDone = false;
let rbacBootstrapPromise: Promise<void> | null = null;
let capabilityMatrixCache: { value: CapabilityMatrix; expiresAt: number } | null = null;

export function normalizeRole(role: unknown): string {
  return String(role || "").trim().toLowerCase();
}

export function isAdministrator(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === "administrator" || normalized === NETWORK_ADMIN_ROLE;
}

export function isKnownUserRole(role: unknown): role is UserRole {
  return normalizeRole(role).length > 0;
}

function normalizeCapabilityMap(input: unknown, fallback: CapabilityMap): CapabilityMap {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const legacyAlias: Partial<Record<SiteCapability, string[]>> = {
    "network.users.manage": ["global.users.manage", "users.manage"],
    "network.rbac.manage": ["rbac.manage"],
    "network.settings.read": ["settings.read"],
    "network.settings.write": ["settings.write"],
    "network.site.manage": ["site.manage"],
    "network.site.delete": ["site.delete"],
    "site.settings.read": ["settings.read"],
    "site.settings.write": ["settings.write"],
    "site.plugins.manage": ["plugins.manage"],
    "site.themes.manage": ["themes.manage"],
    "site.datadomain.manage": ["datadomain.manage", "domain.manage"],
    "site.seo.manage": ["seo.manage"],
    "site.menus.manage": ["menus.manage", "menu.manage"],
    "site.users.manage": ["users.manage"],
    "site.domain.list": ["domain.list", "site.post.read", "site.posts.list"],
    "site.content.read": ["content.read", "site.post.read", "site.posts.read", "site.posts.list"],
    "site.content.create": ["content.create"],
    "site.content.edit.own": ["content.edit.own"],
    "site.content.edit.any": ["content.edit.any"],
    "site.content.delete.own": ["content.delete.own"],
    "site.content.delete.any": ["content.delete.any"],
    "site.content.publish": ["content.publish"],
    "site.taxonomy.manage": ["taxonomy.manage"],
    "site.media.create": ["media.create", "media.manage"],
    "site.media.edit.own": ["media.edit.own", "media.manage"],
    "site.media.edit.any": ["media.edit.any", "media.manage"],
    "site.media.delete.own": ["media.delete.own", "media.manage"],
    "site.media.delete.any": ["media.delete.any", "media.manage"],
    "site.analytics.read": ["analytics.read"],
  };
  return Object.fromEntries(
    SITE_CAPABILITIES.map((capability) => {
      const aliases = legacyAlias[capability] ?? [];
      const legacyValue = aliases
        .map((alias) => source[alias])
        .find((value) => value !== undefined);
      return [capability, Boolean(source[capability] ?? legacyValue ?? fallback[capability])];
    }),
  ) as CapabilityMap;
}

function defaultCapabilityMapFor(role: string): CapabilityMap {
  const all = Object.fromEntries(SITE_CAPABILITIES.map((cap) => [cap, true])) as CapabilityMap;
  const normalized = normalizeRole(role);
  if (normalized === NETWORK_ADMIN_ROLE) return { ...all };
  if (normalized === "administrator") {
    return {
      "network.users.manage": false,
      "network.rbac.manage": false,
      "network.plugins.manage": false,
      "network.settings.read": false,
      "network.settings.write": false,
      "network.site.manage": false,
      "network.site.delete": false,
      "network.themes.manage": false,
      "site.plugins.manage": true,
      "site.themes.manage": true,
      "site.datadomain.manage": true,
      "site.seo.manage": true,
      "site.menus.manage": true,
      "site.settings.read": true,
      "site.settings.write": true,
      "site.users.manage": true,
      "site.domain.list": true,
      "site.content.read": true,
      "site.content.create": true,
      "site.content.edit.own": true,
      "site.content.edit.any": true,
      "site.content.delete.own": true,
      "site.content.delete.any": true,
      "site.content.publish": true,
      "site.taxonomy.manage": true,
      "site.media.create": true,
      "site.media.edit.own": true,
      "site.media.edit.any": true,
      "site.media.delete.own": true,
      "site.media.delete.any": true,
      "site.analytics.read": true,
    };
  }
  if (normalized === "editor") {
    return {
      "network.users.manage": false,
      "network.rbac.manage": false,
      "network.plugins.manage": false,
      "network.settings.read": false,
      "network.settings.write": false,
      "network.site.manage": false,
      "network.site.delete": false,
      "network.themes.manage": false,
      "site.plugins.manage": false,
      "site.themes.manage": false,
      "site.datadomain.manage": false,
      "site.seo.manage": false,
      "site.menus.manage": false,
      "site.settings.read": false,
      "site.settings.write": false,
      "site.users.manage": false,
      "site.domain.list": true,
      "site.content.read": true,
      "site.content.create": true,
      "site.content.edit.own": true,
      "site.content.edit.any": true,
      "site.content.delete.own": true,
      "site.content.delete.any": true,
      "site.content.publish": true,
      "site.taxonomy.manage": true,
      "site.media.create": true,
      "site.media.edit.own": true,
      "site.media.edit.any": true,
      "site.media.delete.own": true,
      "site.media.delete.any": true,
      "site.analytics.read": true,
    };
  }
  if (normalized === "author") {
    return {
      "network.users.manage": false,
      "network.rbac.manage": false,
      "network.plugins.manage": false,
      "network.settings.read": false,
      "network.settings.write": false,
      "network.site.manage": false,
      "network.site.delete": false,
      "network.themes.manage": false,
      "site.plugins.manage": false,
      "site.themes.manage": false,
      "site.datadomain.manage": false,
      "site.seo.manage": false,
      "site.menus.manage": false,
      "site.settings.read": false,
      "site.settings.write": false,
      "site.users.manage": false,
      "site.domain.list": true,
      "site.content.read": true,
      "site.content.create": true,
      "site.content.edit.own": true,
      "site.content.edit.any": false,
      "site.content.delete.own": true,
      "site.content.delete.any": false,
      "site.content.publish": false,
      "site.taxonomy.manage": false,
      "site.media.create": true,
      "site.media.edit.own": true,
      "site.media.edit.any": false,
      "site.media.delete.own": true,
      "site.media.delete.any": false,
      "site.analytics.read": false,
    };
  }
  return {
    "network.users.manage": false,
    "network.rbac.manage": false,
    "network.plugins.manage": false,
    "network.settings.read": false,
    "network.settings.write": false,
    "network.site.manage": false,
    "network.site.delete": false,
    "network.themes.manage": false,
    "site.plugins.manage": false,
    "site.themes.manage": false,
    "site.datadomain.manage": false,
    "site.seo.manage": false,
    "site.menus.manage": false,
    "site.settings.read": false,
    "site.settings.write": false,
    "site.users.manage": false,
    "site.domain.list": false,
    "site.content.read": false,
    "site.content.create": false,
    "site.content.edit.own": false,
    "site.content.edit.any": false,
    "site.content.delete.own": false,
    "site.content.delete.any": false,
    "site.content.publish": false,
    "site.taxonomy.manage": false,
    "site.media.create": false,
    "site.media.edit.own": false,
    "site.media.edit.any": false,
    "site.media.delete.own": false,
    "site.media.delete.any": false,
    "site.analytics.read": false,
  };
}

export function defaultCapabilityMatrix(): CapabilityMatrix {
  const matrix: CapabilityMatrix = {};
  for (const role of SYSTEM_ROLES) {
    matrix[role] = defaultCapabilityMapFor(role);
  }
  return matrix;
}

function normalizeCapabilityMatrix(input: unknown): CapabilityMatrix {
  const base = defaultCapabilityMatrix();
  if (!input || typeof input !== "object") return base;
  const source = input as Record<string, unknown>;
  const out: CapabilityMatrix = { ...base };
  for (const [rawRole, value] of Object.entries(source)) {
    const role = normalizeRole(rawRole);
    if (!role) continue;
    const fallback = out[role] ?? defaultCapabilityMapFor(role);
    out[role] = normalizeCapabilityMap(value, fallback);
  }
  return out;
}

async function seedRoleRow(role: string, capabilities: CapabilityMap, isSystem: boolean) {
  await db
    .insert(rbacRoles)
    .values({ role, capabilities: capabilities as Record<string, boolean>, isSystem })
    .onConflictDoUpdate({
      target: rbacRoles.role,
      set: { capabilities: capabilities as Record<string, boolean>, isSystem, updatedAt: new Date() },
    });
}

async function ensureDynamicRolesTable() {
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  const table = `"${normalizedPrefix}rbac_roles"`;
  await db.execute(sql.raw(
    `CREATE TABLE IF NOT EXISTS ${table} (
      "role" text PRIMARY KEY,
      "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "isSystem" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
  ));
}

async function migrateLegacyMatrixIfNeeded() {
  await ensureDynamicRolesTable();
  const existing = await db.select({ role: rbacRoles.role }).from(rbacRoles);
  if (existing.length > 0) {
    const existingSet = new Set(existing.map((row) => normalizeRole(row.role)));
    for (const role of SYSTEM_ROLES) {
      if (!existingSet.has(role)) {
        await seedRoleRow(role, defaultCapabilityMapFor(role), true);
      }
    }
    return;
  }

  const legacyRaw = await getTextSetting(RBAC_CAPABILITY_MATRIX_KEY, "");
  const legacyMatrix = legacyRaw ? normalizeCapabilityMatrix(JSON.parse(legacyRaw)) : defaultCapabilityMatrix();
  for (const [role, caps] of Object.entries(legacyMatrix)) {
    await seedRoleRow(role, caps, SYSTEM_ROLES.includes(role as (typeof SYSTEM_ROLES)[number]));
  }
}

function invalidateCapabilityMatrixCache() {
  capabilityMatrixCache = null;
}

async function ensureRbacBootstrap() {
  if (rbacBootstrapDone) return;
  if (rbacBootstrapPromise) {
    await rbacBootstrapPromise;
    return;
  }
  rbacBootstrapPromise = (async () => {
    await migrateLegacyMatrixIfNeeded();
    rbacBootstrapDone = true;
    invalidateCapabilityMatrixCache();
  })();
  try {
    await rbacBootstrapPromise;
  } finally {
    rbacBootstrapPromise = null;
  }
}

async function readCapabilityMatrixFromDb() {
  await ensureRbacBootstrap();
  const rows = await db.select().from(rbacRoles);
  const matrix: CapabilityMatrix = {};
  for (const row of rows) {
    const role = normalizeRole(row.role);
    if (!role) continue;
    matrix[role] = normalizeCapabilityMap(row.capabilities, defaultCapabilityMapFor(row.role));
  }
  for (const role of SYSTEM_ROLES) {
    if (!matrix[role]) matrix[role] = defaultCapabilityMapFor(role);
  }
  return matrix;
}

export async function listRbacRoles() {
  const matrix = await getCapabilityMatrix();
  const rows = await db.select({ role: rbacRoles.role, isSystem: rbacRoles.isSystem }).from(rbacRoles);
  const rowMap = new Map(rows.map((row) => [normalizeRole(row.role), row]));
  const merged = new Map<string, { role: string; isSystem: boolean; capabilities: CapabilityMap }>();
  for (const [role, capabilities] of Object.entries(matrix)) {
    const row = rowMap.get(role);
    merged.set(role, {
      role,
      isSystem: row ? Boolean(row.isSystem) : SYSTEM_ROLES.includes(role as (typeof SYSTEM_ROLES)[number]),
      capabilities,
    });
  }
  return rows
    .map((row) => normalizeRole(row.role))
    .filter(Boolean)
    .map((role) => merged.get(role))
    .filter((row): row is { role: string; isSystem: boolean; capabilities: CapabilityMap } => Boolean(row));
}

export async function createRbacRole(role: string) {
  const normalized = normalizeRole(role);
  if (!normalized) throw new Error("Role is required");
  await ensureRbacBootstrap();
  const existing = await db.query.rbacRoles.findFirst({
    where: eq(rbacRoles.role, normalized),
    columns: { role: true },
  });
  if (existing) return;
  await seedRoleRow(normalized, defaultCapabilityMapFor(normalized), false);
  invalidateCapabilityMatrixCache();
}

export async function getCapabilityMatrix() {
  const now = Date.now();
  if (capabilityMatrixCache && capabilityMatrixCache.expiresAt > now) {
    return capabilityMatrixCache.value;
  }
  const matrix = await readCapabilityMatrixFromDb();
  capabilityMatrixCache = { value: matrix, expiresAt: now + CAPABILITY_CACHE_TTL_MS };
  return matrix;
}

export async function saveCapabilityMatrix(matrix: unknown) {
  const normalized = normalizeCapabilityMatrix(matrix);
  await ensureRbacBootstrap();
  for (const [role, capabilities] of Object.entries(normalized)) {
    await seedRoleRow(role, capabilities, SYSTEM_ROLES.includes(role as (typeof SYSTEM_ROLES)[number]));
  }
  await setTextSetting(RBAC_CAPABILITY_MATRIX_KEY, JSON.stringify(normalized));
  invalidateCapabilityMatrixCache();
  return normalized;
}

export async function saveRoleCapabilities(role: string, caps: unknown) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) throw new Error("Role is required");
  await ensureRbacBootstrap();
  const current = await getCapabilityMatrix();
  const fallback = current[normalizedRole] ?? defaultCapabilityMapFor(normalizedRole);
  const next = normalizeCapabilityMap(caps, fallback);
  await seedRoleRow(normalizedRole, next, SYSTEM_ROLES.includes(normalizedRole as (typeof SYSTEM_ROLES)[number]));
  invalidateCapabilityMatrixCache();
  return next;
}

export async function roleHasCapability(role: unknown, capability: SiteCapability) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  const matrix = await getCapabilityMatrix();
  return Boolean(matrix[normalizedRole]?.[capability]);
}

export async function getSiteRoleForUser(siteId: string, userId: string) {
  if (!siteId || !userId) return null;
  const role = await getSiteUserRole(siteId, userId);
  return isKnownUserRole(role) ? role : null;
}

function quoted(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function siteUsersTableName(tableIndex: number) {
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  const prefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
  return `${prefix}site_${tableIndex}_users`;
}

export async function deleteRbacRole(role: string) {
  const normalized = normalizeRole(role);
  if (!normalized) throw new Error("Role is required");
  await ensureRbacBootstrap();

  const existing = await db.query.rbacRoles.findFirst({
    where: eq(rbacRoles.role, normalized),
    columns: { role: true, isSystem: true },
  });
  if (!existing) return;
  if (existing.isSystem) {
    throw new Error("System roles cannot be deleted");
  }

  const inGlobalUsers = await db.query.users.findFirst({
    where: eq(users.role, normalized),
    columns: { id: true },
  });
  if (inGlobalUsers) {
    throw new Error("Cannot delete role while it is assigned to users");
  }

  const registries = await db
    .select({ tableIndex: siteUserTableRegistry.tableIndex })
    .from(siteUserTableRegistry);
  for (const registry of registries) {
    const tableName = siteUsersTableName(registry.tableIndex);
    const result = (await db.execute(
      sql`SELECT 1 FROM ${sql.raw(quoted(tableName))} WHERE "role" = ${normalized} LIMIT 1`,
    )) as { rows?: Array<{ [key: string]: unknown }> };
    if (result.rows?.length) {
      throw new Error("Cannot delete role while it is assigned to site members");
    }
  }

  await db.delete(rbacRoles).where(eq(rbacRoles.role, normalized));
  invalidateCapabilityMatrixCache();
}
