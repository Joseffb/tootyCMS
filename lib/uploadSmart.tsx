// lib/uploadSmart.ts

import { traceClient } from "@/lib/debug-client";

export async function uploadSmart({
                                    file,
                                    name,
                                    siteId,
                                  }: {
  file: File;
  name: string;
  siteId: string;
}): Promise<{ url: string; filename: string }> {
  const mode = String(process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER || "auto").trim().toLowerCase();
  const traceId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  traceClient("upload.client", "upload start", {
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

  const tryEndpoints =
    mode === "blob"
      ? ["/api/uploadImage"]
      : mode === "s3"
        ? ["/api/uploadImageLocal"]
        : mode === "dbblob"
          ? ["/api/uploadImageDb"]
          : ["/api/uploadImage", "/api/uploadImageLocal", "/api/uploadImageDb"];

  let lastError = "Upload failed";
  for (const endpoint of tryEndpoints) {
    const res = await fetch(endpoint, {
      method: "POST",
      body: formData,
      headers: {
        "x-trace-id": String(traceId),
      },
    });
    if (res.ok) {
      const { url, filename } = await res.json();
      traceClient("upload.client", `upload success via ${endpoint}`, { traceId, siteId, name, filename });
      return { url, filename: filename ?? `${siteId}/${name}-${file.name}` };
    }
    lastError = `${endpoint} failed (${res.status})`;
    traceClient("upload.client", `upload failed via ${endpoint}`, { traceId, siteId, name, status: res.status });
  }

  throw new Error(lastError);
}
