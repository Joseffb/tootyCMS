import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import {
  createMediaUploadTraceId,
  deleteMediaRecord,
  deleteMediaTransportObject,
  getMediaRecordById,
  updateMediaRecord,
} from "@/lib/media-service";
import { trace } from "@/lib/debug";

function parseMediaId(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function canManageMediaRecord(userId: string, record: { siteId: string | null; userId: string | null }, mode: "edit" | "delete") {
  const siteId = String(record.siteId || "").trim();
  if (!siteId) return false;
  const anyCapability = mode === "edit" ? "site.media.edit.any" : "site.media.delete.any";
  const ownCapability = mode === "edit" ? "site.media.edit.own" : "site.media.delete.own";
  if (await userCan(anyCapability, userId, { siteId })) return true;
  if (String(record.userId || "").trim() !== userId) return false;
  return userCan(ownCapability, userId, { siteId });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = createMediaUploadTraceId(req);
  const session = await getSession();
  if (!session?.user?.id) {
    trace("media.item", "unauthorized update", { traceId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mediaId = parseMediaId((await params).id);
  if (!mediaId) {
    return NextResponse.json({ error: "Invalid media id" }, { status: 400 });
  }

  const record = await getMediaRecordById(mediaId);
  if (!record) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const allowed = await canManageMediaRecord(session.user.id, record, "edit");
  if (!allowed) {
    trace("media.item", "forbidden update", { traceId, mediaId, siteId: record.siteId, userId: session.user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await req.json().catch(() => null)) as
    | { siteId?: string; label?: string; altText?: string; caption?: string; description?: string }
    | null;
  const siteId = String(payload?.siteId || "").trim();
  if (!siteId || siteId !== String(record.siteId || "").trim()) {
    return NextResponse.json({ error: "Site mismatch" }, { status: 400 });
  }

  const label = String(payload?.label || "").trim();
  const altText = String(payload?.altText || "").trim();
  const caption = String(payload?.caption || "").trim();
  const description = String(payload?.description || "").trim();
  const next = await updateMediaRecord({
    id: mediaId,
    siteId,
    label,
    altText,
    caption,
    description,
  });

  trace("media.item", "update success", { traceId, mediaId, siteId });
  return NextResponse.json({
    item: next
      ? {
          id: next.id,
          siteId: next.siteId,
          userId: next.userId,
          provider: next.provider,
          bucket: next.bucket,
          objectKey: next.objectKey,
          url: next.url,
          label: next.label,
          altText: next.altText,
          caption: next.caption,
          description: next.description,
          mimeType: next.mimeType,
          size: next.size,
        }
      : null,
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = createMediaUploadTraceId(req);
  const session = await getSession();
  if (!session?.user?.id) {
    trace("media.item", "unauthorized delete", { traceId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mediaId = parseMediaId((await params).id);
  if (!mediaId) {
    return NextResponse.json({ error: "Invalid media id" }, { status: 400 });
  }

  const record = await getMediaRecordById(mediaId);
  if (!record) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const allowed = await canManageMediaRecord(session.user.id, record, "delete");
  if (!allowed) {
    trace("media.item", "forbidden delete", { traceId, mediaId, siteId: record.siteId, userId: session.user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await req.json().catch(() => null)) as
    | { siteId?: string; confirm?: string }
    | null;
  const siteId = String(payload?.siteId || "").trim();
  const confirm = String(payload?.confirm || "").trim().toLowerCase();
  if (!siteId || siteId !== String(record.siteId || "").trim()) {
    return NextResponse.json({ error: "Site mismatch" }, { status: 400 });
  }
  if (confirm !== "delete") {
    return NextResponse.json({ error: "Typed confirmation required" }, { status: 400 });
  }

  await deleteMediaTransportObject({
    provider: record.provider,
    bucket: record.bucket,
    objectKey: record.objectKey,
    url: record.url,
    traceId,
    traceNamespace: "media.item",
  });
  await deleteMediaRecord({ id: mediaId, siteId });

  trace("media.item", "delete success", { traceId, mediaId, siteId, provider: record.provider });
  return NextResponse.json({ success: true });
}
