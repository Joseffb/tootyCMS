import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteComment, moderateComment, updateComment } from "@/lib/comments-spine";
import type { CommentStatus } from "@/lib/kernel";

function normalize(value: unknown) {
  return String(value || "").trim();
}

function parseStatus(value: unknown): CommentStatus | undefined {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "pending" || normalized === "approved" || normalized === "rejected" || normalized === "spam" || normalized === "deleted") {
    return normalized;
  }
  return undefined;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const commentId = normalize(id);
  if (!commentId) {
    return NextResponse.json({ ok: false, error: "Comment id is required." }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const siteId = normalize(body.siteId);
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "siteId is required." }, { status: 400 });
  }

  const action = normalize(body.action).toLowerCase();
  try {
    if (action === "moderate") {
      const item = await moderateComment({
        actorUserId: session.user.id,
        providerId: normalize(body.providerId) || undefined,
        id: commentId,
        siteId,
        status: parseStatus(body.status) || "pending",
        reason: normalize(body.reason) || undefined,
      });
      return NextResponse.json({ ok: true, item });
    }

    const item = await updateComment({
      actorUserId: session.user.id,
      providerId: normalize(body.providerId) || undefined,
      id: commentId,
      siteId,
      body: normalize(body.body) || undefined,
      status: parseStatus(body.status),
      metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
    });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update comment." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const commentId = normalize(id);
  if (!commentId) {
    return NextResponse.json({ ok: false, error: "Comment id is required." }, { status: 400 });
  }
  const url = new URL(request.url);
  const siteId = normalize(url.searchParams.get("siteId"));
  const providerId = normalize(url.searchParams.get("providerId"));
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "siteId is required." }, { status: 400 });
  }

  try {
    const result = await deleteComment({
      actorUserId: session.user.id,
      providerId: providerId || undefined,
      id: commentId,
      siteId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to delete comment." },
      { status: 400 },
    );
  }
}
