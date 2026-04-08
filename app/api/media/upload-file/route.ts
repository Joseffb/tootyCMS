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
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  "app",
  "bat",
  "cjs",
  "cmd",
  "com",
  "dll",
  "exe",
  "htm",
  "html",
  "js",
  "mjs",
  "msi",
  "php",
  "phtml",
  "sh",
  "svg",
]);
const BLOCKED_UPLOAD_MIME_TYPES = new Set([
  "application/javascript",
  "application/x-msdownload",
  "application/x-sh",
  "image/svg+xml",
  "text/html",
  "text/javascript",
]);
const ALLOWED_UPLOAD_MIME_TYPES = new Map<string, string[]>([
  ["application/json", ["json"]],
  ["application/pdf", ["pdf"]],
  ["application/zip", ["zip"]],
  ["audio/mpeg", ["mp3"]],
  ["audio/mp4", ["m4a", "mp4"]],
  ["audio/ogg", ["ogg"]],
  ["audio/wav", ["wav"]],
  ["audio/webm", ["webm"]],
  ["image/avif", ["avif"]],
  ["image/gif", ["gif"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
  ["text/csv", ["csv"]],
  ["text/plain", ["md", "text", "txt"]],
  ["video/mp4", ["m4v", "mp4"]],
  ["video/webm", ["webm"]],
]);

function normalizeUploadMimeType(input: string) {
  const normalized = String(input || "").trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  return normalized;
}

function looksLikeTextFile(bytes: Buffer) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const value of sample) {
    if (value === 0) return false;
  }
  return true;
}

function detectMimeTypeFromMagic(bytes: Buffer) {
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "MZ") {
    return "application/x-msdownload";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
    return "application/pdf";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return "audio/wav";
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return "video/webm";
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "avif") return "image/avif";
    if (brand.startsWith("M4A")) return "audio/mp4";
    if (brand.startsWith("qt")) return "";
    return "video/mp4";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return "application/zip";
  }
  return "";
}

function resolveValidatedUploadFile(input: {
  bytes: Buffer;
  declaredMimeType: string;
  fileName: string;
}) {
  const declaredMimeType = normalizeUploadMimeType(input.declaredMimeType);
  const requestedExtension = extensionFromName(input.fileName);
  if (BLOCKED_UPLOAD_EXTENSIONS.has(requestedExtension) || BLOCKED_UPLOAD_MIME_TYPES.has(declaredMimeType)) {
    return { ok: false as const, error: "Unsupported file type." };
  }

  const detectedMimeType = detectMimeTypeFromMagic(input.bytes);
  const effectiveMimeType = detectedMimeType || declaredMimeType;
  if (!effectiveMimeType || !ALLOWED_UPLOAD_MIME_TYPES.has(effectiveMimeType)) {
    return { ok: false as const, error: "Unsupported file type." };
  }
  if (detectedMimeType && declaredMimeType && declaredMimeType !== detectedMimeType) {
    return { ok: false as const, error: "File content does not match the declared file type." };
  }
  if (
    (effectiveMimeType === "text/plain" ||
      effectiveMimeType === "text/csv" ||
      effectiveMimeType === "application/json") &&
    !looksLikeTextFile(input.bytes)
  ) {
    return { ok: false as const, error: "Text uploads must contain valid plain-text content." };
  }

  const allowedExtensions = ALLOWED_UPLOAD_MIME_TYPES.get(effectiveMimeType) || [];
  const extension = allowedExtensions.includes(requestedExtension)
    ? requestedExtension
    : allowedExtensions[0] || requestedExtension || "bin";
  return {
    ok: true as const,
    extension,
    mimeType: effectiveMimeType,
  };
}

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
  const validatedFile = resolveValidatedUploadFile({
    bytes,
    declaredMimeType: file.type || "application/octet-stream",
    fileName: file.name || name,
  });
  if (!validatedFile.ok) {
    return NextResponse.json({ error: validatedFile.error }, { status: 400 });
  }
  const extension = validatedFile.extension;
  const siteSegment = safeMediaSegment(siteId);
  const label = safeMediaSegment(name || file.name || `import-${hash.slice(0, 8)}`);
  const key = `${siteSegment}/imports/${hash}.${extension}`;
  const mimeType = validatedFile.mimeType;
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
