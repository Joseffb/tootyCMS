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

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const traceId = createMediaUploadTraceId(req);
  trace("upload.api.local", "request start", { traceId });
  const formData = await req.formData();

  const file = formData.get("file") as File;
  const siteId = formData.get("siteId") as string;
  const name = formData.get("name") as string;

  if (!file || !siteId || !file.type) {
    trace("upload.api.local", "invalid payload", { traceId });
    return NextResponse.json({ error: "Missing file or siteId" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    trace("upload.api.local", "invalid mime type", { traceId, mimeType: file.type });
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    trace("upload.api.local", "file too large", { traceId, size: file.size });
    return NextResponse.json({ error: "File size too big (max 50MB)" }, { status: 400 });
  }
  if (
    !process.env.AWS_REGION ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY ||
    !process.env.AWS_S3_BUCKET
  ) {
    trace("upload.api.local", "aws config missing", { traceId });
    return NextResponse.json({ error: "AWS S3 fallback is not configured" }, { status: 500 });
  }

  try {
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

    let session: Awaited<ReturnType<typeof getSession>> | null = null;
    try {
      session = await getSession();
    } catch {
      session = null;
    }
    if (!session?.user?.id) {
      trace("upload.api.local", "unauthorized", { traceId, siteId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      await requireMediaUploadAccess(siteId, session.user.id);
    } catch (error: any) {
      trace("upload.api.local", "media quota exceeded", {
        traceId,
        siteId,
        currentItems: error?.details?.currentItems,
        maxItems: error?.details?.maxItems,
      });
      return NextResponse.json(
        {
          error: error?.message || "Upload access denied.",
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.details ? { details: error.details } : {}),
        },
        { status: error?.status || 500 },
      );
    }
    try {
      const existingRows = await findExistingMediaByKeys(siteId, expectedKeys);
      for (const row of existingRows) {
        if (row?.objectKey && row?.url) {
          uploadedByKey.set(row.objectKey, row.url);
        }
      }
    } catch (error) {
      trace("upload.api.local", "existing media lookup failed", {
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
        mode: "s3",
        traceId,
        traceNamespace: "upload.api.local",
      });
      const variantLabel = variant.suffix === "original" ? nameLabel : `${nameLabel}-${variant.suffix}`;
      await upsertMediaRecord({
        siteId,
        userId: session?.user?.id ?? "",
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
    const originalUrl = uploadedByKey.get(originalKey) ?? "";
    trace("upload.api.local", "upload success", {
      traceId,
      siteId,
      objectKey: originalKey,
      provider: "s3",
      size: file.size,
      mimeType,
      userId: session?.user?.id ?? null,
      hash,
    });
    return NextResponse.json({
      url: originalUrl,
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
  } catch (err) {
    console.error("❌ Failed to upload to S3:", err);
    trace("upload.api.local", "upload failed", {
      traceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
