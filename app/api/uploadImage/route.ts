import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { buildMediaVariants } from "@/lib/media-variants";
import { evaluateBotIdRoute } from "@/lib/botid";
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
  try {
    const botId = await evaluateBotIdRoute("api_upload_image");
    if (!botId.allowed) {
      return NextResponse.json(
        {
          error: "Request blocked by BotID policy.",
          code: "BOTID_BLOCKED",
        },
        { status: 403 },
      );
    }

    const traceId = createMediaUploadTraceId(req);
    trace("upload.api.blob", "request start", { traceId });
    if (process.env.NO_IMAGE_MODE === "true") {
      trace("upload.api.blob", "rejected no image mode", { traceId });
      return NextResponse.json(
        { error: "Image uploads are disabled (NO_IMAGE_MODE=true)" },
        { status: 400 },
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      trace("upload.api.blob", "missing blob token", { traceId });
      return NextResponse.json(
        { error: "Missing BLOB_READ_WRITE_TOKEN" },
        { status: 400 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const siteId = formData.get("siteId");
    const name = formData.get("name");

    if (!(file instanceof File) || typeof siteId !== "string" || typeof name !== "string") {
      trace("upload.api.blob", "invalid payload", { traceId, siteIdType: typeof siteId, nameType: typeof name });
      return NextResponse.json({ error: "Missing required upload fields" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({ error: "File size too big (max 50MB)" }, { status: 400 });
    }

    let session: Awaited<ReturnType<typeof getSession>> | null = null;
    try {
      session = await getSession();
    } catch {
      session = null;
    }
    if (!session?.user?.id) {
      trace("upload.api.blob", "unauthorized", { traceId, siteId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      await requireMediaUploadAccess(siteId, session.user.id);
    } catch (error: any) {
      trace("upload.api.blob", "media quota exceeded", {
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
      const existingRows = await findExistingMediaByKeys(expectedKeys);
      for (const row of existingRows) {
        if (row?.objectKey && row?.url) {
          uploadedByKey.set(row.objectKey, row.url);
        }
      }
    } catch (error) {
      trace("upload.api.blob", "existing media lookup failed", {
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
        mode: "blob",
        traceId,
        traceNamespace: "upload.api.blob",
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
    trace("upload.api.blob", "upload success", {
      traceId,
      siteId,
      objectKey: originalKey,
      provider: "blob",
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
  } catch (error) {
    console.error("UploadImage route error:", error);
    trace("upload.api.blob", "upload failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
