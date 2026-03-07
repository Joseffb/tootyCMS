import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { buildMediaVariants } from "@/lib/media-variants";
import {
  createMediaUploadTraceId,
  findExistingMediaByKeys,
  requireMediaUploadAccess,
  resolveMediaUploadTransport,
  safeMediaSegment,
  upsertMediaRecord,
} from "@/lib/media-service";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const traceId = createMediaUploadTraceId(req);
  trace("upload.api.dbblob", "request start", { traceId });
  const formData = await req.formData();

  const file = formData.get("file") as File;
  const siteId = formData.get("siteId") as string;
  const name = formData.get("name") as string;

  if (!file || !siteId || !file.type) {
    return NextResponse.json({ error: "Missing file or siteId" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json({ error: "File size too big for db blob mode (max 5MB)" }, { status: 400 });
  }

  let session: Awaited<ReturnType<typeof getSession>> | null = null;
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const { hash, variants, extension, mimeType } = await buildMediaVariants(file);
  const siteSegment = safeMediaSegment(siteId);
  const nameLabel = safeMediaSegment(name);
  const originalKey = `${siteSegment}/${hash}.${extension}`;
  const uploadedByKey = new Map<string, string>();
  const expectedKeys = variants.map((variant) =>
    variant.suffix === "original"
      ? originalKey
      : `${siteSegment}/${hash}-${variant.suffix}.${extension}`,
  );

  try {
    try {
      const existingRows = await findExistingMediaByKeys(siteId, expectedKeys);
      for (const row of existingRows) {
        if (row?.objectKey && row?.url) {
          uploadedByKey.set(row.objectKey, row.url);
        }
      }
    } catch (error) {
      trace("upload.api.dbblob", "existing media lookup failed", {
        traceId,
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    for (const variant of variants) {
      const key =
        variant.suffix === "original"
          ? originalKey
          : `${siteSegment}/${hash}-${variant.suffix}.${extension}`;
      if (uploadedByKey.has(key)) continue;
      const transport = await resolveMediaUploadTransport({
        key,
        bytes: Buffer.from(variant.buffer),
        mimeType: variant.mimeType,
        mode: "dbblob",
        traceId,
        traceNamespace: "upload.api.dbblob",
      });
      const variantLabel = variant.suffix === "original" ? nameLabel : `${nameLabel}-${variant.suffix}`;
      await upsertMediaRecord({
        siteId,
        userId: session.user.id,
        provider: transport.provider,
        bucket: transport.bucket,
        objectKey: key,
        url: transport.url,
        label: variantLabel,
        mimeType,
        size: variant.buffer.byteLength,
      });
      uploadedByKey.set(key, transport.url);
    }
  } catch (error) {
    trace("upload.api.dbblob", "db write failed", { traceId, error: error instanceof Error ? error.message : String(error) }, "error");
    return NextResponse.json({ error: "DB blob write failed" }, { status: 500 });
  }

  trace("upload.api.dbblob", "upload success", {
    traceId,
    siteId,
    objectKey: originalKey,
    provider: "dbblob",
    size: file.size,
    mimeType,
  });

  return NextResponse.json({
    url: uploadedByKey.get(originalKey) ?? "",
    filename: originalKey,
    hash,
    variants: variants
      .filter((variant) => variant.suffix !== "original")
      .map((variant) => {
        const key = `${siteSegment}/${hash}-${variant.suffix}.${extension}`;
        return {
          suffix: variant.suffix,
          width: variant.width,
          key,
          url: uploadedByKey.get(key),
        };
      }),
  });
}
