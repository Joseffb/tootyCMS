import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import {
  createMediaUploadTraceId,
  extensionFromName,
  normalizeMediaUploadMode,
  requireMediaUploadAccess,
  resolveMediaUploadTransport,
  safeMediaSegment,
  upsertMediaRecord,
} from "@/lib/media-service";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const traceId = createMediaUploadTraceId(req);
  trace("media.upload.file", "request start", { traceId });

  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const siteId = String(formData.get("siteId") || "").trim();
  const name = String(formData.get("name") || "").trim();

  if (!(file instanceof File) || !siteId) {
    return NextResponse.json({ error: "Missing file or siteId." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File size too big (max 50MB)." }, { status: 400 });
  }

  try {
    await requireMediaUploadAccess(siteId, session.user.id);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Upload access denied.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.details ? { details: error.details } : {}),
      },
      { status: error?.status || 500 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const extension = extensionFromName(file.name || name);
  const siteSegment = safeMediaSegment(siteId);
  const label = safeMediaSegment(name || file.name || `import-${hash.slice(0, 8)}`);
  const key = `${siteSegment}/imports/${hash}.${extension}`;
  const mimeType = file.type || "application/octet-stream";
  const requestedProvider = new URL(req.url).searchParams.get("provider");
  const mode = normalizeMediaUploadMode(requestedProvider);
  let transport;
  try {
    transport = await resolveMediaUploadTransport({
      key,
      bytes,
      mimeType,
      mode,
      traceId,
      traceNamespace: "media.upload.file",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Upload provider failed." }, { status: error?.status || 500 });
  }
  const mediaRow = await upsertMediaRecord({
    siteId,
    userId: session.user.id,
    provider: transport.provider,
    bucket: transport.bucket,
    objectKey: key,
    url: transport.url,
    label,
    mimeType,
    size: file.size,
  });

  trace("media.upload.file", "request success", { traceId, siteId, key, provider: transport.provider, size: file.size });
  return NextResponse.json({
    ok: true,
    mediaId: mediaRow?.id ? String(mediaRow.id) : "",
    url: transport.url,
    filename: key,
    provider: transport.provider,
    mimeType,
    size: file.size,
  });
}
