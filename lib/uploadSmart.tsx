// lib/uploadSmart.ts

import { trace } from "@/lib/debug";

export async function uploadSmart({
                                    file,
                                    name,
                                    siteId,
                                  }: {
  file: File;
  name: string;
  siteId: string;
}): Promise<{ url: string; filename: string }> {
  const traceId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  trace("upload.client", "upload start", {
    traceId,
    siteId,
    name,
    mimeType: file.type,
    size: file.size,
  });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  formData.append("siteId", siteId);

  // Try Vercel Blob first.
  const blobRes = await fetch("/api/uploadImage", {
    method: "POST",
    body: formData,
    headers: {
      "x-trace-id": String(traceId),
    },
  });

  if (blobRes.ok) {
    const { url, filename } = await blobRes.json();
    trace("upload.client", "upload success via blob", { traceId, siteId, name, filename });
    return { url, filename: filename ?? `${siteId}/${name}-${file.name}` };
  }
  trace("upload.client", "blob upload failed, trying local", {
    traceId,
    status: blobRes.status,
  });

  // Fallback to local upload
  const localRes = await fetch("/api/uploadImageLocal", {
    method: "POST",
    body: formData,
    headers: {
      "x-trace-id": String(traceId),
    },
  });

  if (!localRes.ok) {
    trace("upload.client", "local upload failed", { traceId, status: localRes.status });
    throw new Error("Local image upload failed");
  }
  const { url, filename } = await localRes.json();
  trace("upload.client", "upload success via local", { traceId, siteId, name, filename });
  return { url, filename: filename ?? `${siteId}/${name}-${file.name}` };
}
