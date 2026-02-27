import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import {
  canUserViewComments,
  createComment,
  getPublicCommentCapabilities,
  listComments,
  listPublicComments,
} from "@/lib/comments-spine";
import { resolveAuthenticatedDisplayName, sanitizePublicCommentMetadata } from "@/lib/comment-identity";
import type { CommentContextType, CommentStatus } from "@/lib/kernel";
import db from "@/lib/db";
import { domainPosts, userMeta, users } from "@/lib/schema";
import { hasPostPasswordAccess } from "@/lib/post-password";
import { verifyThemeBridgeToken } from "@/lib/theme-auth-bridge";

function normalize(value: unknown) {
  return String(value || "").trim();
}

function parseContextType(value: unknown): CommentContextType | undefined {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "entry" || normalized === "group" || normalized === "discussion") {
    return normalized;
  }
  return undefined;
}

function parseStatus(value: unknown): CommentStatus | undefined {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "pending" || normalized === "approved" || normalized === "rejected" || normalized === "spam" || normalized === "deleted") {
    return normalized;
  }
  return undefined;
}

async function hasEntryPasswordAccess(
  siteId: string,
  contextType: CommentContextType | undefined,
  contextId: string | undefined,
) {
  if (contextType !== "entry" || !contextId) return false;
  const entry = await db.query.domainPosts.findFirst({
    where: and(eq(domainPosts.siteId, siteId), eq(domainPosts.id, contextId), eq(domainPosts.published, true)),
    columns: {
      id: true,
      password: true,
    },
  });
  if (!entry || String(entry.password || "").trim().length === 0) return false;
  const cookieStore = await cookies();
  return hasPostPasswordAccess(cookieStore, {
    postId: entry.id,
    password: entry.password,
  });
}

async function resolveUserDisplayName(userId: string) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";
  const metaRow = await db.query.userMeta.findFirst({
    where: and(eq(userMeta.userId, normalizedUserId), eq(userMeta.key, "display_name")),
    columns: { value: true },
  });
  const userRow = await db.query.users.findFirst({
    where: eq(users.id, normalizedUserId),
    columns: { username: true },
  });
  return resolveAuthenticatedDisplayName({
    displayName: String(metaRow?.value || ""),
    username: userRow?.username,
  });
}

async function resolveValidAuthorUserId(userId: string | null | undefined) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const row = await db.query.users.findFirst({
    where: eq(users.id, normalizedUserId),
    columns: { id: true },
  });
  return row?.id ? normalizedUserId : null;
}

async function resolveAuthorIdentity(sessionUserId: string, bridgeUserId: string) {
  const sessionResolved = await resolveValidAuthorUserId(sessionUserId);
  if (sessionResolved) return sessionResolved;
  const bridgeResolved = await resolveValidAuthorUserId(bridgeUserId);
  if (bridgeResolved) return bridgeResolved;
  return null;
}

function toDisplayName(user: {
  displayName?: string;
  username: string | null;
}) {
  return resolveAuthenticatedDisplayName({
    displayName: String(user.displayName || ""),
    username: user.username,
  });
}

async function resolveBridgeUser(request: Request) {
  const rawHeader = String(request.headers.get("x-tooty-theme-bridge") || "").trim();
  if (!rawHeader) {
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:comments.auth] no bridge header");
    }
    return null;
  }
  const claims = await verifyThemeBridgeToken(rawHeader);
  if (!claims?.sub) {
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:comments.auth] invalid bridge header");
    }
    return null;
  }
  if (process.env.TRACE_PROFILE === "Test") {
    console.info("[trace:Test:comments.auth] bridge user resolved", { userId: claims.sub });
  }
  return {
    id: claims.sub,
    email: claims.email || "",
    name: claims.name || "",
    username: claims.username || "",
    displayName: claims.displayName || "",
  };
}

async function enrichCommentDisplayNames(items: any[]) {
  const sanitizedItems = items.map((item) => ({
    ...item,
    metadata: sanitizePublicCommentMetadata(item?.metadata),
  }));
  const authorIds = Array.from(
    new Set(
      sanitizedItems
        .map((item) => String(item?.authorId || "").trim())
        .filter(Boolean),
    ),
  );
  if (authorIds.length === 0) return sanitizedItems;
  const authorRows = await db
    .select({
      id: users.id,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, authorIds));
  const displayNameRows = await db
    .select({
      userId: userMeta.userId,
      value: userMeta.value,
    })
    .from(userMeta)
    .where(and(inArray(userMeta.userId, authorIds), eq(userMeta.key, "display_name")));
  const displayNameByUserId = new Map(
    displayNameRows.map((row) => [String(row.userId), String(row.value || "").trim()]),
  );
  const byId = new Map(
    authorRows.map((row) => [
      String(row.id),
      toDisplayName({
        displayName: displayNameByUserId.get(String(row.id)) || "",
        username: row.username,
      }),
    ]),
  );
  return sanitizedItems.map((item) => {
    const authorId = String(item?.authorId || "").trim();
    const metadata = item?.metadata && typeof item.metadata === "object"
      ? { ...(item.metadata as Record<string, unknown>) }
      : {};
    if (authorId && byId.has(authorId)) {
      const resolved = String(byId.get(authorId) || "").trim();
      if (resolved) (metadata as Record<string, unknown>).author_display_name = resolved;
    }
    return {
      ...item,
      metadata,
    };
  });
}

export async function GET(request: Request) {
  const session = await getSession();
  const bridgeUser = await resolveBridgeUser(request);
  const url = new URL(request.url);
  const siteId = normalize(url.searchParams.get("siteId"));
  const providerId = normalize(url.searchParams.get("providerId")) || undefined;
  const contextType = parseContextType(url.searchParams.get("contextType"));
  const contextId = normalize(url.searchParams.get("contextId")) || undefined;
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "siteId is required." }, { status: 400 });
  }

  try {
    const passwordAccess = await hasEntryPasswordAccess(siteId, contextType, contextId);
    const sessionUserId = normalize(session?.user?.id);
    const bridgeUserId = normalize(bridgeUser?.id);
    const isAuthenticated = Boolean(sessionUserId || bridgeUserId);
    const validAuthorUserId = await resolveAuthorIdentity(sessionUserId, bridgeUserId);
    const canPostAsKnownUser = Boolean(validAuthorUserId);
    if (process.env.TRACE_PROFILE === "Test") {
      console.info("[trace:Test:comments.auth] permission inputs", {
        hasSessionUser: Boolean(normalize(session?.user?.id)),
        hasBridgeUser: Boolean(bridgeUser?.id),
        isAuthenticated,
        canPostAsKnownUser,
      });
    }
    const capabilities = await getPublicCommentCapabilities(siteId, providerId);
    const canViewComments = passwordAccess
      ? true
      : await canUserViewComments(siteId, validAuthorUserId || null, providerId);
    if (!canViewComments) {
      return NextResponse.json({
        ok: true,
        items: [],
        permissions: {
          ...capabilities,
          isAuthenticated,
          canPostAsUser: false,
          canViewComments: false,
        },
      });
    }
    const listInput = {
      providerId,
      siteId,
      contextType,
      contextId,
      status: parseStatus(url.searchParams.get("status")),
      limit: Number(url.searchParams.get("limit") || 50),
      offset: Number(url.searchParams.get("offset") || 0),
    };
    if (passwordAccess && contextType && contextId) {
      const items = await enrichCommentDisplayNames(await listPublicComments(listInput));
      return NextResponse.json({
        ok: true,
        items,
        permissions: {
          ...capabilities,
          isAuthenticated,
          commentsVisibleToPublic: true,
          canPostAuthenticated: true,
          canPostAnonymously: true,
          canPostAsUser: canPostAsKnownUser,
          canViewComments: true,
        },
      });
    }
    if (isAuthenticated && validAuthorUserId) {
      try {
        const items = await listComments({
          actorUserId: validAuthorUserId,
          ...listInput,
        });
        const itemsWithDisplayNames = await enrichCommentDisplayNames(items);
        return NextResponse.json({
          ok: true,
          items: itemsWithDisplayNames,
          permissions: {
            ...capabilities,
            isAuthenticated,
            canPostAsUser: canPostAsKnownUser && Boolean(capabilities.canPostAuthenticated),
            canViewComments,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const fallbackToPublic = message.includes("Forbidden: missing capability site.comment.read") && contextType && contextId;
        if (!fallbackToPublic) throw error;
      }
    }
    const items = await enrichCommentDisplayNames(await listPublicComments(listInput));
    return NextResponse.json({
      ok: true,
      items,
      permissions: {
        ...capabilities,
        isAuthenticated,
        canPostAsUser: canPostAsKnownUser && Boolean(capabilities.canPostAuthenticated),
        canViewComments,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to list comments." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  const bridgeUser = await resolveBridgeUser(request);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const siteId = normalize(body.siteId);
  const contextType = parseContextType(body.contextType);
  const contextId = normalize(body.contextId);
  const commentBody = normalize(body.body);
  const authorName = normalize(body.authorName).slice(0, 120);
  const authorEmail = normalize(body.authorEmail).slice(0, 320).toLowerCase();
  const providerId = normalize(body.providerId) || undefined;
  if (!siteId || !contextType || !contextId || !commentBody) {
    return NextResponse.json(
      { ok: false, error: "siteId, contextType, contextId, and body are required." },
      { status: 400 },
    );
  }
  const capabilities = await getPublicCommentCapabilities(siteId, providerId);
  const passwordAccess = await hasEntryPasswordAccess(siteId, contextType, contextId);
  const sessionUserId = normalize(session?.user?.id);
  const bridgeUserId = normalize(bridgeUser?.id);
  const isAuthenticated = Boolean(sessionUserId || bridgeUserId);
  const validAuthorUserId = await resolveAuthorIdentity(sessionUserId, bridgeUserId);
  const isAnonymous = !validAuthorUserId;
  const resolvedProfileDisplayName = sessionUserId ? await resolveUserDisplayName(sessionUserId) : "";
  const sessionDisplayName = resolveAuthenticatedDisplayName({
    displayName:
      resolvedProfileDisplayName ||
      String(session?.user?.displayName || bridgeUser?.displayName || ""),
    username: session?.user?.username || bridgeUser?.username || session?.user?.name || bridgeUser?.name || "",
  });
  const sessionEmail = normalize(session?.user?.email || bridgeUser?.email).toLowerCase();
  const effectiveAuthorName = authorName || (isAuthenticated ? sessionDisplayName : "");
  const effectiveAuthorEmail = authorEmail || (isAuthenticated ? sessionEmail : "");
  if (!passwordAccess && !isAnonymous && !capabilities.canPostAuthenticated) {
    return NextResponse.json({ ok: false, error: "Signed-in comments are disabled." }, { status: 403 });
  }
  if (!passwordAccess && isAnonymous && !capabilities.canPostAnonymously) {
    return NextResponse.json({ ok: false, error: "Anonymous comments are disabled." }, { status: 403 });
  }
  if (isAnonymous && capabilities.anonymousIdentityFields.name && !effectiveAuthorName) {
    return NextResponse.json({ ok: false, error: "Name is required for anonymous comments." }, { status: 400 });
  }
  if (isAnonymous && capabilities.anonymousIdentityFields.email && !effectiveAuthorEmail) {
    return NextResponse.json({ ok: false, error: "Email is required for anonymous comments." }, { status: 400 });
  }
  if (effectiveAuthorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveAuthorEmail)) {
    return NextResponse.json({ ok: false, error: "Email is invalid." }, { status: 400 });
  }

  try {
    const metadata: Record<string, unknown> =
      body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {};
    if (isAnonymous) {
      if (effectiveAuthorName) {
        metadata.author_name = effectiveAuthorName;
        metadata.author_display_name = effectiveAuthorName;
      }
      if (effectiveAuthorEmail) metadata.author_email = effectiveAuthorEmail;
    } else {
      const signedInDisplayName = await resolveUserDisplayName(String(session?.user?.id || ""));
      if (signedInDisplayName) {
        metadata.author_display_name = signedInDisplayName;
        metadata.author_name = signedInDisplayName;
      }
    }
    const createPayload = {
      providerId,
      siteId,
      contextType,
      contextId,
      body: commentBody,
      parentId: normalize(body.parentId) || undefined,
      status: parseStatus(body.status),
    } as const;
    if (passwordAccess) {
      const item = await createComment({
        actorUserId: validAuthorUserId,
        ...createPayload,
        metadata,
        skipCapabilityChecks: true,
      });
      return NextResponse.json({ ok: true, item: { ...item, metadata: sanitizePublicCommentMetadata(item.metadata) } });
    }
    try {
      const item = await createComment({
        actorUserId: validAuthorUserId,
        ...createPayload,
        metadata,
      });
      return NextResponse.json({ ok: true, item: { ...item, metadata: sanitizePublicCommentMetadata(item.metadata) } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create comment.";
      const shouldFallbackToAnonymous =
        isAuthenticated &&
        capabilities.canPostAnonymously &&
        message.includes("Forbidden: missing capability site.comment.create");
      if (!shouldFallbackToAnonymous) {
        throw error;
      }
      // Signed-in user without create capability can still post as anonymous if provider allows it.
      if (effectiveAuthorName) {
        metadata.author_name = effectiveAuthorName;
        metadata.author_display_name = effectiveAuthorName;
      }
      if (effectiveAuthorEmail) metadata.author_email = effectiveAuthorEmail;
      const item = await createComment({
        actorUserId: null,
        ...createPayload,
        metadata,
      });
      return NextResponse.json({ ok: true, item: { ...item, metadata: sanitizePublicCommentMetadata(item.metadata) } });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create comment." },
      { status: 400 },
    );
  }
}
