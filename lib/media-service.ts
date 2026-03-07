import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { DeleteObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq, inArray } from "drizzle-orm";
import db from "@/lib/db";
import { sites } from "@/lib/schema";
import { userCan } from "@/lib/authorization";
import { assertSiteMediaQuotaAvailable } from "@/lib/media-governance";
import { trace } from "@/lib/debug";
import {
  ensureSiteMediaTable,
  getSiteMediaTable,
  isMissingSiteMediaRelationError,
  resetSiteMediaTableCache,
} from "@/lib/site-media-tables";

export type MediaUploadProvider = "blob" | "s3" | "dbblob";
export type MediaUploadMode = MediaUploadProvider | "auto";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export function safeMediaSegment(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

export function extensionFromName(name: string) {
  const clean = String(name || "").trim();
  const match = clean.match(/\.([a-zA-Z0-9]{1,16})$/);
  return match?.[1]?.toLowerCase() || "bin";
}

export function normalizeMediaUploadMode(input?: string | null): MediaUploadMode {
  const raw = String(
    input || process.env.MEDIA_UPLOAD_PROVIDER || process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER || "auto",
  )
    .trim()
    .toLowerCase();
  if (raw === "blob" || raw === "s3" || raw === "dbblob") return raw;
  return "auto";
}

export function resolveMediaUploadCandidates(mode?: string | null): MediaUploadProvider[] {
  const normalized = normalizeMediaUploadMode(mode);
  if (normalized === "auto") return ["blob", "s3", "dbblob"];
  return [normalized];
}

export function resolveS3ObjectAcl(input?: string | null) {
  const value = String(input || process.env.AWS_S3_OBJECT_ACL || "")
    .trim()
    .toLowerCase();
  return value === "public-read" ? "public-read" : undefined;
}

export function buildS3ObjectUrl(bucket: string, key: string, region?: string | null) {
  const normalizedBucket = String(bucket || "").trim();
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  const normalizedRegion = String(region || process.env.AWS_REGION || "us-east-1").trim();
  if (normalizedRegion && normalizedRegion !== "us-east-1") {
    return `https://${normalizedBucket}.s3.${normalizedRegion}.amazonaws.com/${normalizedKey}`;
  }
  return `https://${normalizedBucket}.s3.amazonaws.com/${normalizedKey}`;
}

export async function requireMediaUploadAccess(siteId: string, userId: string) {
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true },
  });
  if (!site) {
    throw Object.assign(new Error("Site not found"), { status: 404 });
  }

  const canUpload = await userCan("site.media.create", userId, { siteId: site.id });
  if (!canUpload) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  const quota = await assertSiteMediaQuotaAvailable(site.id);
  if (!quota.allowed) {
    throw Object.assign(new Error("Media library limit reached for this site."), {
      status: 429,
      code: "media_quota_exceeded",
      details: { maxItems: quota.maxItems, currentItems: quota.currentItems },
    });
  }

  return site;
}

export async function resolveMediaUploadTransport({
  key,
  bytes,
  mimeType,
  mode,
  traceId,
  traceNamespace,
}: {
  key: string;
  bytes: Buffer;
  mimeType: string;
  mode?: string | null;
  traceId?: string;
  traceNamespace: string;
}): Promise<{ url: string; provider: MediaUploadProvider; bucket: string }> {
  const candidates = resolveMediaUploadCandidates(mode);
  let lastError = "Upload provider failed.";

  for (const candidate of candidates) {
    try {
      if (candidate === "blob") {
        if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Missing BLOB_READ_WRITE_TOKEN");
        const uploaded = await put(
          key,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          {
            access: "public",
            contentType: mimeType,
            addRandomSuffix: false,
          },
        );
        return { url: uploaded.url, provider: "blob", bucket: "vercel_blob" };
      }

      if (candidate === "s3") {
        if (!process.env.AWS_S3_BUCKET) throw new Error("Missing AWS_S3_BUCKET");
        const acl = resolveS3ObjectAcl();
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: mimeType,
            ...(acl ? { ACL: acl } : {}),
          }),
        );
        return {
          url: buildS3ObjectUrl(process.env.AWS_S3_BUCKET, key, process.env.AWS_REGION),
          provider: "s3",
          bucket: process.env.AWS_S3_BUCKET,
        };
      }

      const url = `data:${mimeType};base64,${bytes.toString("base64")}`;
      return { url, provider: "dbblob", bucket: "dbblob" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      trace(traceNamespace, "provider candidate failed", { traceId, key, provider: candidate, error: lastError }, "info");
    }
  }

  trace(traceNamespace, "provider failed", { traceId, key, error: lastError }, "error");
  throw Object.assign(new Error(lastError || "Upload provider failed."), { status: 500 });
}

export async function upsertMediaRecord(input: {
  siteId: string;
  userId: string;
  provider: MediaUploadProvider;
  bucket: string;
  objectKey: string;
  url: string;
  label: string;
  mimeType: string;
  size: number;
}) {
  const normalizedSiteId = String(input.siteId || "").trim();
  if (!normalizedSiteId) return null;
  return withSiteMediaRecovery(normalizedSiteId, async () => {
    const media = getSiteMediaTable(normalizedSiteId);
    const query = db
      .insert(media)
      .values({
        userId: input.userId,
        provider: input.provider,
        bucket: input.bucket,
        objectKey: input.objectKey,
        url: input.url,
        label: input.label,
        mimeType: input.mimeType,
        size: input.size,
      })
      .onConflictDoUpdate({
        target: media.objectKey,
        set: {
          userId: input.userId,
          provider: input.provider,
          bucket: input.bucket,
          url: input.url,
          label: input.label,
          mimeType: input.mimeType,
          size: input.size,
          updatedAt: new Date(),
        },
      });
    const withReturning = query as typeof query & {
      returning?: (selection: {
        id: typeof media.id;
        url: typeof media.url;
        mimeType: typeof media.mimeType;
        label: typeof media.label;
      }) => Promise<Array<{ id: number; url: string; mimeType: string | null; label: string | null }>>;
    };
    if (typeof withReturning.returning === "function") {
      const rows = await withReturning.returning({
        id: media.id,
        url: media.url,
        mimeType: media.mimeType,
        label: media.label,
      });
      return rows[0] || null;
    }

    await query;
    return null;
  });
}

export async function findExistingMediaByKeys(
  siteId: string,
  objectKeys: string[],
): Promise<Array<{ objectKey: string; url: string }>> {
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedSiteId) return [];
  if (!Array.isArray(objectKeys) || objectKeys.length === 0) return [];
  return withSiteMediaRecovery(normalizedSiteId, async () => {
    const media = getSiteMediaTable(normalizedSiteId);
    return db
      .select({
        objectKey: media.objectKey,
        url: media.url,
      })
      .from(media)
      .where(inArray(media.objectKey, objectKeys));
  });
}

async function withSiteMediaRecovery<T>(siteId: string, run: () => Promise<T>): Promise<T> {
  await ensureSiteMediaTable(siteId);
  try {
    return await run();
  } catch (error) {
    if (!isMissingSiteMediaRelationError(error)) throw error;
    resetSiteMediaTableCache(siteId);
    await ensureSiteMediaTable(siteId);
    return run();
  }
}

export function createMediaUploadTraceId(req: Request) {
  return req.headers.get("x-trace-id") || randomUUID();
}

export async function deleteMediaTransportObject(input: {
  provider: string;
  bucket?: string | null;
  objectKey: string;
  url?: string | null;
  traceId?: string;
  traceNamespace: string;
}) {
  const provider = String(input.provider || "").trim().toLowerCase();
  try {
    if (provider === "blob") {
      if (!input.url) throw new Error("Missing blob URL");
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Missing BLOB_READ_WRITE_TOKEN");
      await del(input.url);
      return;
    }
    if (provider === "s3") {
      const bucket = String(input.bucket || process.env.AWS_S3_BUCKET || "").trim();
      if (!bucket) throw new Error("Missing AWS_S3_BUCKET");
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: input.objectKey,
        }),
      );
      return;
    }
    if (provider === "dbblob") return;
    throw new Error(`Unsupported media provider: ${provider}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace(input.traceNamespace, "provider delete failed", {
      traceId: input.traceId,
      provider,
      key: input.objectKey,
      error: message,
    }, "error");
    throw Object.assign(new Error(message || "Failed to delete media asset."), { status: 500 });
  }
}

export async function getMediaRecordById(id: number) {
  const siteRows = await db.select({ id: sites.id }).from(sites);
  for (const site of siteRows) {
    const siteId = String(site.id || "").trim();
    if (!siteId) continue;
    const rows = await withSiteMediaRecovery(siteId, async () => {
      const media = getSiteMediaTable(siteId);
      return db
        .select({
          id: media.id,
          userId: media.userId,
          provider: media.provider,
          bucket: media.bucket,
          objectKey: media.objectKey,
          url: media.url,
          label: media.label,
          altText: media.altText,
          caption: media.caption,
          description: media.description,
          mimeType: media.mimeType,
          size: media.size,
        })
        .from(media)
        .where(eq(media.id, id))
        .limit(1);
    });
    if (rows[0]) {
      return {
        ...rows[0],
        siteId,
      };
    }
  }
  return null;
}

export async function updateMediaRecord(input: {
  id: number;
  siteId: string;
  label: string;
  altText: string;
  caption: string;
  description: string;
}) {
  await withSiteMediaRecovery(input.siteId, async () => {
    const media = getSiteMediaTable(input.siteId);
    await db
      .update(media)
      .set({
        label: input.label,
        altText: input.altText,
        caption: input.caption,
        description: input.description,
        updatedAt: new Date(),
      })
      .where(eq(media.id, input.id));
  });
  return getMediaRecordById(input.id);
}

export async function deleteMediaRecord(input: { id: number; siteId: string }) {
  await withSiteMediaRecovery(input.siteId, async () => {
    const media = getSiteMediaTable(input.siteId);
    await db.delete(media).where(eq(media.id, input.id));
  });
}
