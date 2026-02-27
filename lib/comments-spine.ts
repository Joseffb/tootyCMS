import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import db from "@/lib/db";
import { communicationMessages, domainPosts } from "@/lib/schema";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { emitDomainEvent } from "@/lib/domain-dispatch";
import { ensureSiteCommentTables } from "@/lib/site-comment-tables";
import { listPluginsWithSiteState } from "@/lib/plugins";
import { getSiteBooleanSetting } from "@/lib/cms-config";
import type {
  CommentContextType,
  CommentCreateInput,
  CommentDeleteInput,
  CommentListInput,
  CommentModerateInput,
  CommentRecord,
  CommentStatus,
  CommentUpdateInput,
  CommentProviderWritingOption,
  PluginCommentProviderRegistration,
} from "@/lib/kernel";

const ALLOWED_CONTEXT_TYPES: CommentContextType[] = ["entry", "group", "discussion"];
const ALLOWED_STATUSES: CommentStatus[] = ["pending", "approved", "rejected", "spam", "deleted"];
const MODERATION_STATUSES: CommentStatus[] = ["pending", "approved", "rejected"];
const CORE_PROVIDER_ID = "tooty-comments";
const LEGACY_CORE_PROVIDER_ID = "core-basic";
const CORE_ALLOW_AUTHENTICATED_OPTION_KEY = "allow_authenticated_comments";
const CORE_ALLOW_ANONYMOUS_OPTION_KEY = "allow_anonymous_comments";
const CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY = "show_comments_to_public";
const CORE_AUTO_APPROVE_COMMENTS_OPTION_KEY = "auto_approve_comments";
const CORE_SHOW_ROLE_ADMINISTRATOR_OPTION_KEY = "show_comments_role_administrator";
const CORE_SHOW_ROLE_EDITOR_OPTION_KEY = "show_comments_role_editor";
const CORE_SHOW_ROLE_AUTHOR_OPTION_KEY = "show_comments_role_author";
const CORE_SHOW_ROLE_NETWORK_ADMIN_OPTION_KEY = "show_comments_role_network_admin";

type ResolvedCommentProvider = PluginCommentProviderRegistration & { pluginId: string };

export type CommentProviderWritingOptionState = CommentProviderWritingOption & {
  providerId: string;
  settingKey: string;
  formField: string;
  value: boolean;
};

export type PublicCommentCapabilities = {
  commentsVisibleToPublic: boolean;
  canPostAuthenticated: boolean;
  canPostAnonymously: boolean;
  anonymousIdentityFields: {
    name: boolean;
    email: boolean;
  };
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

function normalizeOptionToken(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "_")
    .slice(0, 80);
}

function providerSettingKey(providerId: string, optionKey: string) {
  return `writing_comment_provider_${normalizeOptionToken(providerId)}_${normalizeOptionToken(optionKey)}`;
}

function providerOptionFormField(providerId: string, optionKey: string) {
  return `comment_provider_option_${normalizeOptionToken(providerId)}__${normalizeOptionToken(optionKey)}`;
}

function quoted(identifier: string) {
  return `"${String(identifier || "").replace(/"/g, "\"\"")}"`;
}

type QueryRows<T> = { rows?: T[] };

function normalizeContextType(value: unknown): CommentContextType {
  const normalized = normalize(value).toLowerCase();
  if (!ALLOWED_CONTEXT_TYPES.includes(normalized as CommentContextType)) {
    throw new Error(`Unsupported comment context type: ${normalized || "(empty)"}`);
  }
  return normalized as CommentContextType;
}

function normalizeStatus(value: unknown, fallback: CommentStatus = "pending"): CommentStatus {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  if (!ALLOWED_STATUSES.includes(normalized as CommentStatus)) {
    throw new Error(`Unsupported comment status: ${normalized}`);
  }
  return normalized as CommentStatus;
}

function normalizeModerationStatus(value: unknown, fallback: CommentStatus = "pending"): CommentStatus {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  if (!MODERATION_STATUSES.includes(normalized as CommentStatus)) {
    throw new Error(`Unsupported moderation status: ${normalized}`);
  }
  return normalized as CommentStatus;
}

function toCommentRecord(siteId: string, row: any, metadata: Record<string, unknown>): CommentRecord {
  return {
    id: normalize(row.id),
    siteId,
    contextType: normalizeContextType(row.context_type),
    contextId: normalize(row.context_id),
    authorId: normalize(row.author_id) || null,
    body: normalize(row.body),
    status: normalizeStatus(row.status, "pending"),
    parentId: normalize(row.parent_id) || null,
    metadata,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at || "")),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at || "")),
  };
}

async function upsertCommentMeta(metaTable: string, commentId: string, metadata: Record<string, unknown>) {
  for (const [key, value] of Object.entries(metadata || {})) {
    const finalKey = normalize(key).slice(0, 120);
    if (!finalKey) continue;
    const finalValue = JSON.stringify(value ?? null);
    await db.execute(sql`
      INSERT INTO ${sql.raw(quoted(metaTable))} ("site_comment_id", "key", "value")
      VALUES (${commentId}, ${finalKey}, ${finalValue})
      ON CONFLICT ("site_comment_id", "key")
      DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()
    `);
  }
}

async function loadCommentMeta(metaTable: string, commentId: string) {
  const result = (await db.execute(
    sql`SELECT "key", "value" FROM ${sql.raw(quoted(metaTable))} WHERE "site_comment_id" = ${commentId}`,
  )) as QueryRows<{ key?: string; value?: string }>;
  const out: Record<string, unknown> = {};
  for (const row of result.rows || []) {
    const key = normalize(row.key);
    if (!key) continue;
    const raw = String(row.value || "");
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

async function validateContext(siteId: string, contextType: CommentContextType, contextId: string) {
  if (contextType === "entry") {
    const row = await db.query.domainPosts.findFirst({
      where: and(eq(domainPosts.siteId, siteId), eq(domainPosts.id, contextId)),
      columns: { id: true },
    });
    if (!row) throw new Error("Comment context entry was not found for this site.");
    return;
  }
  const kernel = await createKernelForRequest(siteId);
  const response = await kernel.applyFilters<Response | null>("domain:query", null, {
    name: "comments.context.validate",
    params: { siteId, contextType, contextId },
  });
  if (!(response instanceof Response) || !response.ok) {
    throw new Error(`Comment context validation failed for context type "${contextType}".`);
  }
}

export async function hasEnabledCommentProvider(siteId: string) {
  if (typeof listPluginsWithSiteState !== "function") return true;
  try {
    const plugins = await listPluginsWithSiteState(siteId);
    const commentProviders = plugins.filter((plugin) => Boolean((plugin as any)?.capabilities?.commentProviders));
    if (commentProviders.length === 0) return true;
    return commentProviders.some((plugin) => plugin.enabled && plugin.siteEnabled);
  } catch {
    return true;
  }
}

async function requireCapability(
  capability: "site.comment.create" | "site.comment.moderate" | "site.comment.read",
  actorUserId: string,
  siteId: string,
) {
  const allowed = await userCan(capability, actorUserId, { siteId });
  if (!allowed) throw new Error(`Forbidden: missing capability ${capability}`);
}

function createCoreProvider(siteId: string, commentsTable: string, commentMetaTable: string): PluginCommentProviderRegistration {
  return {
    id: CORE_PROVIDER_ID,
    supportsAnonymousCreate: true,
    anonymousIdentityFields: {
      name: true,
      email: true,
    },
    writingOptions: [
      {
        key: CORE_ALLOW_AUTHENTICATED_OPTION_KEY,
        label: "Allow internal user comments",
        type: "checkbox",
        description: "Allow signed-in internal users to post comments.",
        defaultValue: true,
        dependsOn: { key: CORE_ALLOW_ANONYMOUS_OPTION_KEY, value: false },
      },
      {
        key: CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY,
        label: "Show comments to public",
        type: "checkbox",
        description: "When off, comments are visible only to signed-in users.",
        defaultValue: true,
      },
      {
        key: CORE_ALLOW_ANONYMOUS_OPTION_KEY,
        label: "Allow anonymous comments",
        type: "checkbox",
        description: "Allow guests to comment using name and email. Email is stored for moderation and never shown publicly.",
        defaultValue: true,
      },
      {
        key: CORE_AUTO_APPROVE_COMMENTS_OPTION_KEY,
        label: "Auto approve comments",
        type: "checkbox",
        description: "Automatically publish new comments unless moderation providers override status.",
        defaultValue: false,
      },
      {
        key: CORE_SHOW_ROLE_ADMINISTRATOR_OPTION_KEY,
        label: "Show comments to site administrators",
        type: "checkbox",
        description: "Used only when 'Show comments to public' is off.",
        defaultValue: true,
        dependsOn: { key: CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY, value: false },
      },
      {
        key: CORE_SHOW_ROLE_EDITOR_OPTION_KEY,
        label: "Show comments to site editors",
        type: "checkbox",
        description: "Used only when 'Show comments to public' is off.",
        defaultValue: true,
        dependsOn: { key: CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY, value: false },
      },
      {
        key: CORE_SHOW_ROLE_AUTHOR_OPTION_KEY,
        label: "Show comments to site authors",
        type: "checkbox",
        description: "Used only when 'Show comments to public' is off.",
        defaultValue: true,
        dependsOn: { key: CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY, value: false },
      },
      {
        key: CORE_SHOW_ROLE_NETWORK_ADMIN_OPTION_KEY,
        label: "Show comments to network admins",
        type: "checkbox",
        description: "Used only when 'Show comments to public' is off.",
        defaultValue: true,
        dependsOn: { key: CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY, value: false },
      },
    ],
    async create(input) {
      const commentId = createId();
      const parentId = normalize(input.parentId);
      if (parentId) {
        const parent = (await db.execute(
          sql`SELECT "id", "parent_id" FROM ${sql.raw(quoted(commentsTable))} WHERE "id" = ${parentId} LIMIT 1`,
        )) as QueryRows<{ id?: string; parent_id?: string | null }>;
        const parentRow = parent.rows?.[0];
        if (!parentRow?.id) {
          throw new Error("Parent comment not found.");
        }
        if (normalize(parentRow.parent_id)) {
          throw new Error("Only one level of comment threading is allowed.");
        }
      }
      const inserted = (await db.execute(sql`
        INSERT INTO ${sql.raw(quoted(commentsTable))}
          ("id", "author_id", "context_type", "context_id", "body", "status", "parent_id")
        VALUES
          (${commentId}, ${input.authorId || null}, ${normalizeContextType(input.contextType)}, ${normalize(input.contextId)}, ${normalize(input.body)}, ${normalizeStatus(input.status, "pending")}, ${parentId || null})
        RETURNING *
      `)) as QueryRows<any>;
      const row = inserted.rows?.[0];
      if (!row) throw new Error("Failed to create comment.");
      await upsertCommentMeta(commentMetaTable, commentId, input.metadata || {});
      const metadata = await loadCommentMeta(commentMetaTable, commentId);
      return toCommentRecord(siteId, row, metadata);
    },
    async update(input) {
      const current = (await db.execute(
        sql`SELECT * FROM ${sql.raw(quoted(commentsTable))} WHERE "id" = ${normalize(input.id)} LIMIT 1`,
      )) as QueryRows<any>;
      const row = current.rows?.[0];
      if (!row) throw new Error("Comment not found.");
      const nextBody = input.body !== undefined ? normalize(input.body) : String(row.body || "");
      const nextStatus = input.status !== undefined ? normalizeStatus(input.status, "pending") : normalizeStatus(row.status, "pending");
      const updated = (await db.execute(sql`
        UPDATE ${sql.raw(quoted(commentsTable))}
        SET "body" = ${nextBody}, "status" = ${nextStatus}, "updated_at" = NOW()
        WHERE "id" = ${normalize(input.id)}
        RETURNING *
      `)) as QueryRows<any>;
      const updatedRow = updated.rows?.[0];
      if (!updatedRow) throw new Error("Comment not found.");
      if (input.metadata && typeof input.metadata === "object") {
        await upsertCommentMeta(commentMetaTable, normalize(input.id), input.metadata);
      }
      const metadata = await loadCommentMeta(commentMetaTable, normalize(input.id));
      return toCommentRecord(siteId, updatedRow, metadata);
    },
    async delete(input) {
      const updated = (await db.execute(sql`
        UPDATE ${sql.raw(quoted(commentsTable))}
        SET "status" = 'deleted', "updated_at" = NOW()
        WHERE "id" = ${normalize(input.id)}
        RETURNING "id"
      `)) as QueryRows<{ id?: string }>;
      return { ok: Boolean(updated.rows?.[0]?.id) };
    },
    async list(input) {
      const conditions = [sql`1=1`];
      if (input.contextType) conditions.push(sql`"context_type" = ${normalizeContextType(input.contextType)}`);
      if (input.contextId) conditions.push(sql`"context_id" = ${normalize(input.contextId)}`);
      if (input.status) conditions.push(sql`"status" = ${normalizeStatus(input.status, "pending")}`);
      const limit = Math.max(1, Math.min(200, Math.trunc(Number(input.limit || 50))));
      const offset = Math.max(0, Math.trunc(Number(input.offset || 0)));
      const rows = (await db.execute(sql`
        SELECT *
        FROM ${sql.raw(quoted(commentsTable))}
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `)) as QueryRows<any>;
      const items: CommentRecord[] = [];
      for (const row of rows.rows || []) {
        const metadata = await loadCommentMeta(commentMetaTable, normalize(row.id));
        items.push(toCommentRecord(siteId, row, metadata));
      }
      return items;
    },
    async moderate(input) {
      const updated = (await db.execute(sql`
        UPDATE ${sql.raw(quoted(commentsTable))}
        SET "status" = ${normalizeStatus(input.status, "pending")}, "updated_at" = NOW()
        WHERE "id" = ${normalize(input.id)}
        RETURNING *
      `)) as QueryRows<any>;
      const row = updated.rows?.[0];
      if (!row) throw new Error("Comment not found.");
      const metadata = await loadCommentMeta(commentMetaTable, normalize(input.id));
      return toCommentRecord(siteId, row, metadata);
    },
  };
}

async function resolveProvider(siteId: string, preferredProviderId?: string): Promise<ResolvedCommentProvider> {
  const commentsEnabled = await hasEnabledCommentProvider(siteId);
  if (!commentsEnabled) {
    throw new Error("No comment provider is enabled for this site.");
  }
  const tables = await ensureSiteCommentTables(siteId);
  const normalizedPreferred = normalize(preferredProviderId).toLowerCase();
  const kernel = await createKernelForRequest(siteId);
  const pluginProviders = kernel.getAllPluginCommentProviders();
  if (!normalizedPreferred) {
    return pluginProviders[0] || { pluginId: "core", ...createCoreProvider(siteId, tables.commentsTable, tables.commentMetaTable) };
  }
  if (
    normalizedPreferred === CORE_PROVIDER_ID ||
    normalizedPreferred === `core:${CORE_PROVIDER_ID}` ||
    normalizedPreferred === LEGACY_CORE_PROVIDER_ID ||
    normalizedPreferred === `core:${LEGACY_CORE_PROVIDER_ID}`
  ) {
    return { pluginId: "core", ...createCoreProvider(siteId, tables.commentsTable, tables.commentMetaTable) };
  }
  const matched = pluginProviders.find((provider) => {
    const full = `${provider.pluginId}:${provider.id}`.toLowerCase();
    return provider.id.toLowerCase() === normalizedPreferred || full === normalizedPreferred;
  });
  if (matched) return matched;
  throw new Error(`Unknown comment provider: ${normalizedPreferred}`);
}

async function getProviderWritingOptionStates(provider: ResolvedCommentProvider, siteId: string) {
  const options = Array.isArray(provider.writingOptions) ? provider.writingOptions : [];
  const states: CommentProviderWritingOptionState[] = [];
  for (const option of options) {
    const optionKey = normalizeOptionToken(option?.key);
    if (!optionKey || option.type !== "checkbox") continue;
    const providerId = normalizeOptionToken(provider.id || provider.pluginId || CORE_PROVIDER_ID);
    const settingKey = providerSettingKey(providerId, optionKey);
    const defaultValue = Boolean(option.defaultValue);
    let value = defaultValue;
    try {
      value = await getSiteBooleanSetting(siteId, settingKey, defaultValue);
    } catch {
      value = defaultValue;
    }
    states.push({
      ...option,
      key: optionKey,
      providerId,
      settingKey,
      formField: providerOptionFormField(providerId, optionKey),
      value,
    });
  }
  return states;
}

async function isAnonymousPostingEnabled(siteId: string, provider: ResolvedCommentProvider) {
  if (!provider.supportsAnonymousCreate) return false;
  const options = await getProviderWritingOptionStates(provider, siteId);
  const allowOption = options.find((option) => option.key === CORE_ALLOW_ANONYMOUS_OPTION_KEY);
  return Boolean(allowOption?.value);
}

async function isAuthenticatedPostingEnabled(siteId: string, provider: ResolvedCommentProvider) {
  const publicVisible = await isPublicCommentVisibilityEnabled(siteId, provider);
  if (publicVisible) return true;
  const options = await getProviderWritingOptionStates(provider, siteId);
  const allowOption = options.find((option) => option.key === CORE_ALLOW_AUTHENTICATED_OPTION_KEY);
  return allowOption ? Boolean(allowOption.value) : true;
}

async function isPublicCommentVisibilityEnabled(siteId: string, provider: ResolvedCommentProvider) {
  const options = await getProviderWritingOptionStates(provider, siteId);
  const allowOption = options.find((option) => option.key === CORE_SHOW_PUBLIC_COMMENTS_OPTION_KEY);
  return allowOption ? Boolean(allowOption.value) : true;
}

async function isAutoApproveEnabled(siteId: string, provider: ResolvedCommentProvider) {
  const options = await getProviderWritingOptionStates(provider, siteId);
  const allowOption = options.find((option) => option.key === CORE_AUTO_APPROVE_COMMENTS_OPTION_KEY);
  return allowOption ? Boolean(allowOption.value) : false;
}

async function getInternalRoleVisibility(siteId: string, provider: ResolvedCommentProvider) {
  const options = await getProviderWritingOptionStates(provider, siteId);
  const getValue = (key: string, fallback: boolean) => {
    const option = options.find((item) => item.key === key);
    return option ? Boolean(option.value) : fallback;
  };
  return {
    administrator: getValue(CORE_SHOW_ROLE_ADMINISTRATOR_OPTION_KEY, true),
    editor: getValue(CORE_SHOW_ROLE_EDITOR_OPTION_KEY, true),
    author: getValue(CORE_SHOW_ROLE_AUTHOR_OPTION_KEY, true),
    networkAdmin: getValue(CORE_SHOW_ROLE_NETWORK_ADMIN_OPTION_KEY, true),
  };
}

async function applyPreCreateModeration(input: {
  siteId: string;
  providerId: string;
  contextType: CommentContextType;
  contextId: string;
  authorId: string | null;
  body: string;
  metadata: Record<string, unknown>;
}) {
  const kernel = await createKernelForRequest(input.siteId);
  const response = await kernel.applyFilters<Response | null>("domain:query", null, {
    name: "comments.moderation.precreate",
    params: {
      ...input,
      actorType: input.authorId ? "user" : "anonymous",
    },
  });
  if (!(response instanceof Response) || !response.ok) {
    return { blocked: false as const, status: undefined as CommentStatus | undefined };
  }
  try {
    const payload = (await response.json()) as {
      action?: "allow" | "approve" | "pending" | "spam" | "reject";
      reason?: string;
    };
    const action = normalize(payload?.action).toLowerCase();
    if (action === "reject") {
      return {
        blocked: true as const,
        status: undefined,
        reason: normalize(payload?.reason) || "Comment rejected by moderation policy.",
      };
    }
    if (action === "approve") return { blocked: false as const, status: "approved" as CommentStatus };
    if (action === "pending") return { blocked: false as const, status: "pending" as CommentStatus };
    if (action === "spam") return { blocked: false as const, status: "spam" as CommentStatus };
  } catch {
    // Ignore malformed moderation payloads and continue with default state.
  }
  return { blocked: false as const, status: undefined as CommentStatus | undefined };
}

export async function getCommentProviderWritingOptions(siteId: string, preferredProviderId?: string) {
  const normalizedSiteId = normalize(siteId);
  if (!normalizedSiteId) return [];
  const provider = await resolveProvider(normalizedSiteId, preferredProviderId);
  return getProviderWritingOptionStates(provider, normalizedSiteId);
}

export async function getPublicCommentCapabilities(siteId: string, preferredProviderId?: string): Promise<PublicCommentCapabilities> {
  const normalizedSiteId = normalize(siteId);
  if (!normalizedSiteId) {
    return {
      commentsVisibleToPublic: false,
      canPostAuthenticated: false,
      canPostAnonymously: false,
      anonymousIdentityFields: { name: false, email: false },
    };
  }
  const provider = await resolveProvider(normalizedSiteId, preferredProviderId);
  const commentsVisibleToPublic = await isPublicCommentVisibilityEnabled(normalizedSiteId, provider);
  const canPostAuthenticated = await isAuthenticatedPostingEnabled(normalizedSiteId, provider);
  const canPostAnonymously = await isAnonymousPostingEnabled(normalizedSiteId, provider);
  const identity = provider.anonymousIdentityFields || {};
  return {
    commentsVisibleToPublic,
    canPostAuthenticated,
    canPostAnonymously,
    anonymousIdentityFields: {
      name: canPostAnonymously ? Boolean(identity.name ?? true) : false,
      email: canPostAnonymously ? Boolean(identity.email ?? true) : false,
    },
  };
}

export async function canUserViewComments(siteId: string, actorUserId?: string | null, preferredProviderId?: string) {
  const normalizedSiteId = normalize(siteId);
  if (!normalizedSiteId) return false;
  const provider = await resolveProvider(normalizedSiteId, preferredProviderId);
  const commentsVisibleToPublic = await isPublicCommentVisibilityEnabled(normalizedSiteId, provider);
  if (commentsVisibleToPublic) return true;
  const userId = normalize(actorUserId);
  if (!userId) return false;
  const visibility = await getInternalRoleVisibility(normalizedSiteId, provider);

  // Capability checks preserve centralized authorization and role hierarchy.
  if (visibility.networkAdmin && await userCan("network.site.manage", userId)) return true;
  if (visibility.administrator && await userCan("site.settings.manage", userId, { siteId: normalizedSiteId })) return true;
  if (visibility.editor && await userCan("site.content.publish", userId, { siteId: normalizedSiteId })) return true;
  if (visibility.author && await userCan("site.content.edit_own", userId, { siteId: normalizedSiteId })) return true;
  return false;
}

async function writeCommentAudit(input: {
  siteId: string;
  actorUserId?: string | null;
  action: string;
  commentId: string;
  contextType: CommentContextType;
  contextId: string;
  status?: CommentStatus;
}) {
  const actorId = normalize(input.actorUserId) || "anonymous";
  await db.insert(communicationMessages).values({
    id: createId(),
    siteId: input.siteId,
    channel: "com-x",
    to: "audit://comments",
    subject: `[comment] ${input.action}`,
    body:
      `Comment action: ${input.action}\n` +
      `Comment ID: ${input.commentId}\n` +
      `Site: ${input.siteId}\n` +
      `Context: ${input.contextType}:${input.contextId}\n` +
      `Actor: ${actorId}` +
      (input.status ? `\nStatus: ${input.status}` : ""),
    category: "transactional",
    status: "logged",
    providerId: "core:comment-audit",
    createdByUserId: normalize(input.actorUserId) || null,
    metadata: {
      kind: "comment_audit",
      action: input.action,
      commentId: input.commentId,
      contextType: input.contextType,
      contextId: input.contextId,
      actorUserId: actorId,
      status: input.status || null,
    },
    maxAttempts: 1,
    attemptCount: 1,
  });
}

export async function createComment(
  input: CommentCreateInput & {
    actorUserId?: string | null;
    providerId?: string;
    skipCapabilityChecks?: boolean;
  },
) {
  const siteId = normalize(input.siteId);
  const contextType = normalizeContextType(input.contextType);
  const contextId = normalize(input.contextId);
  const body = normalize(input.body);
  const actorUserId = normalize(input.actorUserId) || null;
  if (!siteId || !contextId || !body) throw new Error("siteId, contextId, and body are required.");
  const provider = await resolveProvider(siteId, input.providerId);
  if (!input.skipCapabilityChecks) {
    if (actorUserId) {
      const canPostAuthenticated = await isAuthenticatedPostingEnabled(siteId, provider);
      if (!canPostAuthenticated) {
        throw new Error("Forbidden: signed-in comments are disabled.");
      }
      await requireCapability("site.comment.create", actorUserId, siteId);
    } else {
      const canPostAnonymously = await isAnonymousPostingEnabled(siteId, provider);
      if (!canPostAnonymously) {
        throw new Error("Forbidden: anonymous comments are disabled.");
      }
    }
  }
  await validateContext(siteId, contextType, contextId);
  const moderation = await applyPreCreateModeration({
    siteId,
    providerId: provider.id,
    contextType,
    contextId,
    authorId: actorUserId,
    body,
    metadata: input.metadata || {},
  });
  if (moderation.blocked) {
    throw new Error(moderation.reason || "Comment rejected by moderation policy.");
  }
  const autoApprove = await isAutoApproveEnabled(siteId, provider);
  const resolvedStatus =
    moderation.status || (input.status ? normalizeStatus(input.status, "pending") : autoApprove ? "approved" : "pending");
  const created = await provider.create({
    siteId,
    contextType,
    contextId,
    authorId: actorUserId,
    body,
    parentId: input.parentId || null,
    metadata: input.metadata || {},
    status: resolvedStatus,
  });
  await emitDomainEvent({
    version: 1,
    name: "comment.created",
    timestamp: new Date().toISOString(),
    siteId,
    actorType: actorUserId ? "user" : "anonymous",
    actorId: actorUserId || undefined,
    payload: {
      id: created.id,
      siteId: created.siteId,
      contextType: created.contextType,
      contextId: created.contextId,
      authorId: created.authorId,
      status: created.status,
    },
  });
  await writeCommentAudit({
    siteId,
    actorUserId,
    action: "created",
    commentId: created.id,
    contextType: created.contextType,
    contextId: created.contextId,
    status: created.status,
  });
  const kernel = await createKernelForRequest(siteId);
  await kernel.doAction("comment:created", created);
  return created;
}

export async function listComments(input: CommentListInput & { actorUserId: string; providerId?: string }) {
  const siteId = normalize(input.siteId);
  if (!siteId) throw new Error("siteId is required.");
  await requireCapability("site.comment.read", input.actorUserId, siteId);
  if (input.contextType && input.contextId) {
    await validateContext(siteId, normalizeContextType(input.contextType), normalize(input.contextId));
  }
  const provider = await resolveProvider(siteId, input.providerId);
  return provider.list({
    siteId,
    contextType: input.contextType ? normalizeContextType(input.contextType) : undefined,
    contextId: input.contextId ? normalize(input.contextId) : undefined,
    status: input.status ? normalizeStatus(input.status, "pending") : undefined,
    limit: input.limit,
    offset: input.offset,
  });
}

export async function listPublicComments(input: CommentListInput & { providerId?: string }) {
  const siteId = normalize(input.siteId);
  if (!siteId) throw new Error("siteId is required.");
  const contextType = input.contextType ? normalizeContextType(input.contextType) : undefined;
  const contextId = input.contextId ? normalize(input.contextId) : undefined;
  if (!contextType || !contextId) {
    throw new Error("contextType and contextId are required for public comment listing.");
  }
  await validateContext(siteId, contextType, contextId);
  const provider = await resolveProvider(siteId, input.providerId);
  return provider.list({
    siteId,
    contextType,
    contextId,
    status: "approved",
    limit: input.limit,
    offset: input.offset,
  });
}

export async function moderateComment(input: CommentModerateInput & { actorUserId: string; providerId?: string }) {
  const siteId = normalize(input.siteId);
  const id = normalize(input.id);
  if (!siteId || !id) throw new Error("siteId and id are required.");
  await requireCapability("site.comment.moderate", input.actorUserId, siteId);
  const provider = await resolveProvider(siteId, input.providerId);
  const moderated = await provider.moderate({
    id,
    siteId,
    actorUserId: input.actorUserId,
    status: normalizeModerationStatus(input.status, "pending"),
    reason: normalize(input.reason) || undefined,
  });
  await emitDomainEvent({
    version: 1,
    name: "comment.moderated",
    timestamp: new Date().toISOString(),
    siteId,
    actorType: "admin",
    actorId: input.actorUserId,
    payload: {
      id: moderated.id,
      siteId: moderated.siteId,
      contextType: moderated.contextType,
      contextId: moderated.contextId,
      status: moderated.status,
    },
  });
  await writeCommentAudit({
    siteId,
    actorUserId: input.actorUserId,
    action: "moderated",
    commentId: moderated.id,
    contextType: moderated.contextType,
    contextId: moderated.contextId,
    status: moderated.status,
  });
  const kernel = await createKernelForRequest(siteId);
  await kernel.doAction("comment:moderated", moderated);
  return moderated;
}

export async function updateComment(input: CommentUpdateInput & { actorUserId: string; providerId?: string }) {
  const siteId = normalize(input.siteId);
  const id = normalize(input.id);
  if (!siteId || !id) throw new Error("siteId and id are required.");
  const provider = await resolveProvider(siteId, input.providerId);
  const existing = await provider.list({ siteId, limit: 5000, offset: 0 });
  const target = existing.find((entry) => entry.id === id);
  if (!target) throw new Error("Comment not found.");
  const isModerator = await userCan("site.comment.moderate", input.actorUserId, { siteId });
  if (normalize(target.authorId) !== normalize(input.actorUserId) && !isModerator) {
    throw new Error("Forbidden: only comment author or moderator can update this comment.");
  }
  const updated = await provider.update({
    ...input,
    id,
    siteId,
    actorUserId: input.actorUserId,
    status: input.status ? normalizeStatus(input.status, "pending") : undefined,
  });
  await emitDomainEvent({
    version: 1,
    name: "comment.updated",
    timestamp: new Date().toISOString(),
    siteId,
    actorType: "user",
    actorId: input.actorUserId,
    payload: {
      id: updated.id,
      siteId: updated.siteId,
      contextType: updated.contextType,
      contextId: updated.contextId,
      status: updated.status,
    },
  });
  await writeCommentAudit({
    siteId,
    actorUserId: input.actorUserId,
    action: "updated",
    commentId: updated.id,
    contextType: updated.contextType,
    contextId: updated.contextId,
    status: updated.status,
  });
  const kernel = await createKernelForRequest(siteId);
  await kernel.doAction("comment:updated", updated);
  return updated;
}

export async function deleteComment(input: CommentDeleteInput & { actorUserId: string; providerId?: string }) {
  const siteId = normalize(input.siteId);
  const id = normalize(input.id);
  if (!siteId || !id) throw new Error("siteId and id are required.");
  await requireCapability("site.comment.moderate", input.actorUserId, siteId);
  const existingProvider = await resolveProvider(siteId, input.providerId);
  const existing = await existingProvider.list({ siteId, limit: 1, offset: 0 });
  const target = existing.find((entry) => entry.id === id);
  if (!target) throw new Error("Comment not found.");
  const result = await existingProvider.delete({ id, siteId, actorUserId: input.actorUserId });
  if (!result?.ok) throw new Error("Comment delete was rejected by provider.");
  await emitDomainEvent({
    version: 1,
    name: "comment.deleted",
    timestamp: new Date().toISOString(),
    siteId,
    actorType: "admin",
    actorId: input.actorUserId,
    payload: {
      id,
      siteId,
      contextType: target.contextType,
      contextId: target.contextId,
    },
  });
  await writeCommentAudit({
    siteId,
    actorUserId: input.actorUserId,
    action: "deleted",
    commentId: id,
    contextType: target.contextType,
    contextId: target.contextId,
    status: "deleted",
  });
  const kernel = await createKernelForRequest(siteId);
  await kernel.doAction("comment:deleted", {
    id,
    siteId,
    contextType: target.contextType,
    contextId: target.contextId,
  });
  return { ok: true, id };
}

export async function listCommentsForExport(siteId: string) {
  return listComments({
    siteId: normalize(siteId),
    actorUserId: "system",
    limit: 5000,
    offset: 0,
    providerId: `core:${CORE_PROVIDER_ID}`,
  });
}
