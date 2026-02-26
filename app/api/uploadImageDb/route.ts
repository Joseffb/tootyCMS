import { NextResponse } from "next/server";
import crypto from "crypto";

import db from "@/lib/db";
import { media, sites } from "@/lib/schema";
import { getSession } from "@/lib/auth";
import { trace } from "@/lib/debug";
import { eq } from "drizzle-orm";
import { userCan } from "@/lib/authorization";
import { assertSiteMediaQuotaAvailable } from "@/lib/media-governance";

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

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  const ext = file.type.split("/")[1] || "bin";
  const objectKey = `${safeSegment(siteId)}/${hash}.${ext}`;
  const label = safeSegment(name);

  try {
    await db
      .insert(media)
      .values({
        siteId,
        userId: session.user.id,
        provider: "dbblob",
        bucket: "dbblob",
        objectKey,
        url: dataUrl,
        label,
        mimeType: file.type,
        size: file.size,
      })
      .onConflictDoUpdate({
        target: media.objectKey,
        set: {
          siteId,
          userId: session.user.id,
          provider: "dbblob",
          bucket: "dbblob",
          url: dataUrl,
          label,
          mimeType: file.type,
          size: file.size,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    trace("upload.api.dbblob", "db write failed", { traceId, error: error instanceof Error ? error.message : String(error) }, "error");
    return NextResponse.json({ error: "DB blob write failed" }, { status: 500 });
  }

  trace("upload.api.dbblob", "upload success", {
    traceId,
    siteId,
    objectKey,
    provider: "dbblob",
    size: file.size,
    mimeType: file.type,
  });

  return NextResponse.json({
    url: dataUrl,
    filename: objectKey,
    hash,
    variants: [],
  });
}
