import { NextResponse } from "next/server";
import crypto from "crypto";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import db from "@/lib/db";
import { media, sites } from "@/lib/schema";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { and, eq, inArray } from "drizzle-orm";
import { buildMediaVariants } from "@/lib/media-variants";
import { userCan } from "@/lib/authorization";

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

function safeSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
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
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { id: true },
    });
    if (!site) {
      trace("upload.api.local", "site not found", { traceId, siteId });
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    const canUpload = await userCan("site.media.create", session.user.id, { siteId: site.id });
    if (!canUpload) {
      trace("upload.api.local", "forbidden", { traceId, siteId, userId: session.user.id });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    for (const variant of variants) {
      const key =
        variant.suffix === "original"
          ? originalKey
          : `${siteSegment}/${hash}-${variant.suffix}.${extension}`;
      let url = existingByKey.get(key);

      if (!url) {
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET!,
            Key: key,
            Body: variant.buffer,
            ContentType: variant.mimeType,
            ACL: "public-read",
          }),
        );
        url = `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${key}`;
      }

      const variantLabel = variant.suffix === "original" ? nameLabel : `${nameLabel}-${variant.suffix}`;
      try {
        await db
          .insert(media)
          .values({
            siteId,
            userId: session?.user?.id ?? null,
            provider: "s3",
            bucket: process.env.AWS_S3_BUCKET!,
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
              provider: "s3",
              bucket: process.env.AWS_S3_BUCKET!,
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
            url: existingByKey.get(key),
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
