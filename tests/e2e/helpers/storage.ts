import { sql } from "@vercel/postgres";
import { ensureDefaultCoreDataDomainsForSite } from "@/lib/default-data-domains";
import { ensureSiteUserTables } from "@/lib/site-user-tables";
import { findSiteDataDomainByKey, upsertSiteDataDomain } from "@/lib/site-data-domain-registry";
import { ensureSiteSettingsTable } from "@/lib/site-settings-tables";
import {
  createSiteDomainPost,
  getSiteDomainPostById,
  updateSiteDomainPostById,
  deleteSiteDomainPostById,
  upsertSiteDomainPostMeta,
} from "@/lib/site-domain-post-store";
import {
  siteDomainTypeMetaTableName,
  siteDomainTypeMetaTableTemplate,
  siteDomainTypeTableName,
  siteDomainTypeTableTemplate,
} from "@/lib/site-domain-type-tables";
import { sitePhysicalTableName } from "@/lib/site-physical-table-name";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const sqlClient = sql as typeof sql & {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};
function isTransientDbError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return code === "40P01" || code === "55P03";
}

async function withDbRetry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

export function quotedIdentifier(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

export function networkTableName(suffix: string) {
  return `${normalizedPrefix}network_${String(suffix || "").trim()}`;
}

export function siteFeatureTableName(siteId: string, suffix: string) {
  return sitePhysicalTableName(normalizedPrefix, siteId, suffix);
}

export function siteDomainContentTable(siteId: string, domainKey: string) {
  return siteDomainTypeTableName(siteId, domainKey);
}

export function siteDomainMetaTable(siteId: string, domainKey: string) {
  return siteDomainTypeMetaTableName(siteId, domainKey);
}

export async function ensureNetworkUser(params: {
  id: string;
  email: string;
  name: string;
  role: string;
  username?: string;
  authProvider?: string;
  passwordHash?: string | null;
}) {
  const table = quotedIdentifier(networkTableName("users"));
  await withDbRetry(() =>
    sqlClient.query(
      `INSERT INTO ${table} ("id", "email", "name", "username", "role", "authProvider", "passwordHash", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE
       SET "email" = EXCLUDED."email",
           "name" = EXCLUDED."name",
           "username" = EXCLUDED."username",
           "role" = EXCLUDED."role",
           "authProvider" = EXCLUDED."authProvider",
           "passwordHash" = EXCLUDED."passwordHash",
           "updatedAt" = NOW()`,
      [
        params.id,
        params.email,
        params.name,
        params.username ? String(params.username) : null,
        params.role,
        params.authProvider || "native",
        params.passwordHash ?? null,
      ],
    ),
  );
}

export async function ensureNetworkUserMeta(userId: string, key: string, value: string) {
  const table = quotedIdentifier(networkTableName("user_meta"));
  await withDbRetry(() => sqlClient.query(`DELETE FROM ${table} WHERE "userId" = $1 AND "key" = $2`, [userId, key]));
  await withDbRetry(() =>
    sqlClient.query(
      `INSERT INTO ${table} ("userId", "key", "value", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [userId, key, value],
    ),
  );
}

export async function ensureNetworkSite(params: {
  id: string;
  userId: string;
  name: string;
  subdomain: string;
  isPrimary: boolean;
}) {
  const table = quotedIdentifier(networkTableName("sites"));
  await withDbRetry(() =>
    sqlClient.query(
      `INSERT INTO ${table} ("id", "userId", "name", "subdomain", "isPrimary", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE
       SET "userId" = EXCLUDED."userId",
           "name" = EXCLUDED."name",
           "subdomain" = EXCLUDED."subdomain",
           "isPrimary" = EXCLUDED."isPrimary",
           "updatedAt" = NOW()`,
      [params.id, params.userId, params.name, params.subdomain, params.isPrimary],
    ),
  );
  await withDbRetry(() => ensureSiteSettingsTable(params.id));
  await withDbRetry(() => ensureSiteUserTables(params.id));
}

export async function ensureNetworkSession(sessionToken: string, userId: string, expires: Date | string) {
  const table = quotedIdentifier(networkTableName("sessions"));
  await withDbRetry(() =>
    sqlClient.query(
      `INSERT INTO ${table} ("sessionToken", "userId", "expires")
       VALUES ($1, $2, $3)
       ON CONFLICT ("sessionToken") DO UPDATE
       SET "userId" = EXCLUDED."userId",
           "expires" = EXCLUDED."expires"`,
      [sessionToken, userId, expires instanceof Date ? expires.toISOString() : expires],
    ),
  );
}

export async function ensureCoreSiteDomain(siteId: string, domainKey: "post" | "page" = "post") {
  await ensureDefaultCoreDataDomainsForSite(siteId);
  const row = await findSiteDataDomainByKey(siteId, domainKey);
  if (!row) throw new Error(`Failed to resolve core domain ${domainKey} for site ${siteId}.`);
  return row;
}

export async function ensureCustomSiteDomain(siteId: string, input: {
  key: string;
  label: string;
  description?: string;
  settings?: Record<string, unknown>;
}) {
  const key = String(input.key || "").trim();
  const row = await upsertSiteDataDomain(siteId, {
    key,
    label: input.label,
    contentTable: siteDomainTypeTableTemplate(key),
    metaTable: siteDomainTypeMetaTableTemplate(key),
    description: input.description,
    settings: input.settings || {},
    isActive: true,
  });
  return row;
}

export async function ensureSitePost(input: {
  siteId: string;
  domainKey: string;
  id: string;
  userId?: string;
  slug: string;
  title: string;
  description?: string;
  content?: string;
  image?: string;
  published?: boolean;
}) {
  const existing = await findSiteDataDomainByKey(input.siteId, input.domainKey);
  if (!existing) {
    throw new Error(`Domain ${input.domainKey} is not registered for site ${input.siteId}.`);
  }
  const existingPost = await getSiteDomainPostById({
    siteId: input.siteId,
    postId: input.id,
    dataDomainKey: existing.key,
  });
  const record = existingPost
    ? await updateSiteDomainPostById({
        siteId: input.siteId,
        postId: input.id,
        dataDomainKey: existing.key,
        patch: {
          slug: input.slug,
          title: input.title,
          description: input.description || "",
          content: input.content || "",
          image: input.image || "",
          published: input.published !== false,
        },
      })
    : await createSiteDomainPost({
        id: input.id,
        siteId: input.siteId,
        dataDomainId: existing.id,
        dataDomainKey: existing.key,
        userId: input.userId,
        slug: input.slug,
        title: input.title,
        description: input.description || "",
        content: input.content || "",
        image: input.image || "",
        published: input.published !== false,
      });
  if (!record) throw new Error(`Failed to create site post ${input.id}.`);
  return record;
}

export async function upsertSiteMeta(input: {
  siteId: string;
  domainKey: string;
  postId: string;
  key: string;
  value: string;
}) {
  await upsertSiteDomainPostMeta({
    siteId: input.siteId,
    dataDomainKey: input.domainKey,
    postId: input.postId,
    key: input.key,
    value: input.value,
  });
}

export async function deleteSitePost(siteId: string, domainKey: string, postId: string) {
  await deleteSiteDomainPostById({ siteId, dataDomainKey: domainKey, postId });
}
