import { NextResponse } from "next/server";
import crypto from "crypto";

import db from "@/lib/db";
import { media, sites } from "@/lib/schema";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { and, eq, inArray } from "drizzle-orm";
import { userCan } from "@/lib/authorization";
import { assertSiteMediaQuotaAvailable } from "@/lib/media-governance";
import { buildMediaVariants } from "@/lib/media-variants";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function safeSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

export async function POST(req: Request) {
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
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

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const canUpload = await userCan("site.media.create", session.user.id, { siteId: site.id });
  if (!canUpload) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const quota = await assertSiteMediaQuotaAvailable(site.id);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "Media library limit reached for this site.",
        code: "media_quota_exceeded",
        details: { maxItems: quota.maxItems, currentItems: quota.currentItems },
      },
      { status: 429 },
    );
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

  try {
    for (const variant of variants) {
      const key =
        variant.suffix === "original"
          ? originalKey
          : `${siteSegment}/${hash}-${variant.suffix}.${extension}`;
      let url = existingByKey.get(key);
      if (!url) {
        const bytes = Buffer.from(variant.buffer);
        url = `data:${variant.mimeType};base64,${bytes.toString("base64")}`;
      }
      const variantLabel = variant.suffix === "original" ? nameLabel : `${nameLabel}-${variant.suffix}`;

      await db
        .insert(media)
        .values({
          siteId,
          userId: session.user.id,
          provider: "dbblob",
          bucket: "dbblob",
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
            userId: session.user.id,
            provider: "dbblob",
            bucket: "dbblob",
            url,
            label: variantLabel,
            mimeType,
            size: variant.buffer.byteLength,
            updatedAt: new Date(),
          },
        });
      existingByKey.set(key, url);
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
    url: existingByKey.get(originalKey) ?? "",
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
}
