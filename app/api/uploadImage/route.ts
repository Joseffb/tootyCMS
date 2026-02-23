import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { media } from "@/lib/schema";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { and, eq, inArray } from "drizzle-orm";
import { buildMediaVariants } from "@/lib/media-variants";
import { evaluateBotIdRoute } from "@/lib/botid";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

function safeSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

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

    const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
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
    const { hash, variants, extension, mimeType } = await buildMediaVariants(file);
    const siteSegment = safeSegment(siteId);
    const nameLabel = safeSegment(name);
    const originalKey = `${siteSegment}/${hash}.${extension}`;
    const variantKeys = variants
      .filter((variant) => variant.suffix !== "original")
      .map((variant) => `${siteSegment}/${hash}-${variant.suffix}.${extension}`);
    const allKeys = [originalKey, ...variantKeys];

    let existingByKey = new Map<string, string>();
    try {
      const existing = await db
        .select({
          objectKey: media.objectKey,
          url: media.url,
        })
        .from(media)
        .where(and(eq(media.siteId, siteId), inArray(media.objectKey, allKeys)));
      existingByKey = new Map(existing.map((row) => [row.objectKey, row.url]));
    } catch {
      existingByKey = new Map<string, string>();
    }

    for (const variant of variants) {
      const key =
        variant.suffix === "original"
          ? originalKey
          : `${siteSegment}/${hash}-${variant.suffix}.${extension}`;

      let url = existingByKey.get(key);
      if (!url) {
        const body = variant.buffer.buffer.slice(
          variant.buffer.byteOffset,
          variant.buffer.byteOffset + variant.buffer.byteLength
        ) as ArrayBuffer;
        const uploaded = await put(key, body, {
          access: "public",
          contentType: variant.mimeType,
          addRandomSuffix: false,
        });
        url = uploaded.url;
      }

      const variantLabel = variant.suffix === "original" ? nameLabel : `${nameLabel}-${variant.suffix}`;
      try {
        await db
          .insert(media)
          .values({
            siteId,
            userId: session?.user?.id ?? null,
            provider: "blob",
            bucket: "vercel_blob",
            objectKey: key,
            url,
            label: variantLabel,
            mimeType,
            size: variant.buffer.byteLength,
          })
          .onConflictDoUpdate({
            target: media.objectKey,
            set: {
              siteId,
              userId: session?.user?.id ?? null,
              provider: "blob",
              bucket: "vercel_blob",
              url,
              label: variantLabel,
              mimeType,
              size: variant.buffer.byteLength,
              updatedAt: new Date(),
            },
          });
      } catch {
        // allow upload flow to succeed even when DB is unavailable
      }
      existingByKey.set(key, url);
    }

    const originalUrl = existingByKey.get(originalKey) ?? "";
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
            url: existingByKey.get(key),
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
