import { NextResponse } from "next/server";
import crypto from "crypto";
import { put } from "@vercel/blob";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import db from "@/lib/db";
import { media, sites } from "@/lib/schema";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { assertSiteMediaQuotaAvailable } from "@/lib/media-governance";
import { trace } from "@/lib/debug";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

function safeSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "file";
}

function extensionFromName(name: string) {
  const clean = String(name || "").trim();
  const match = clean.match(/\.([a-zA-Z0-9]{1,16})$/);
  return match?.[1]?.toLowerCase() || "bin";
}

function providerMode() {
  const raw = String(process.env.MEDIA_UPLOAD_PROVIDER || process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  if (raw === "blob" || raw === "s3" || raw === "dbblob") return raw;
  return "auto";
}

export async function POST(req: Request) {
  const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
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

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
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

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const extension = extensionFromName(file.name || name);
  const siteSegment = safeSegment(siteId);
  const label = safeSegment(name || file.name || `import-${hash.slice(0, 8)}`);
  const key = `${siteSegment}/imports/${hash}.${extension}`;
  const mimeType = file.type || "application/octet-stream";

  const mode = providerMode();
  const candidates = mode === "auto" ? ["blob", "s3", "dbblob"] : [mode];
  let url = "";
  let provider = "";
  let bucket = "";
  let lastError = "Upload failed.";

  for (const candidate of candidates) {
    try {
      if (candidate === "blob") {
        if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Missing BLOB_READ_WRITE_TOKEN");
        const uploaded = await put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
          access: "public",
          contentType: mimeType,
          addRandomSuffix: false,
        });
        url = uploaded.url;
        provider = "blob";
        bucket = "vercel_blob";
        break;
      }

      if (candidate === "s3") {
        if (!process.env.AWS_S3_BUCKET) throw new Error("Missing AWS_S3_BUCKET");
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: mimeType,
            ACL: "public-read",
          }),
        );
        url = `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${key}`;
        provider = "s3";
        bucket = process.env.AWS_S3_BUCKET;
        break;
      }

      if (candidate === "dbblob") {
        url = `data:${mimeType};base64,${bytes.toString("base64")}`;
        provider = "dbblob";
        bucket = "dbblob";
        break;
      }
    } catch (error: any) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!url) {
    trace("media.upload.file", "provider failed", { traceId, siteId, key, error: lastError }, "error");
    return NextResponse.json({ error: lastError || "Upload provider failed." }, { status: 500 });
  }

  await db
    .insert(media)
    .values({
      siteId,
      userId: session.user.id,
      provider,
      bucket,
      objectKey: key,
      url,
      label,
      mimeType,
      size: file.size,
    })
    .onConflictDoUpdate({
      target: media.objectKey,
      set: {
        siteId,
        userId: session.user.id,
        provider,
        bucket,
        url,
        label,
        mimeType,
        size: file.size,
        updatedAt: new Date(),
      },
    });

  trace("media.upload.file", "request success", { traceId, siteId, key, provider, size: file.size });
  return NextResponse.json({
    ok: true,
    url,
    filename: key,
    provider,
    mimeType,
    size: file.size,
  });
}
