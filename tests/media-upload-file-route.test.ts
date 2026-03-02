import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  requireMediaUploadAccessMock,
  resolveMediaUploadTransportMock,
  upsertMediaRecordMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  requireMediaUploadAccessMock: vi.fn(),
  resolveMediaUploadTransportMock: vi.fn(),
  upsertMediaRecordMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/media-service", () => ({
  createMediaUploadTraceId: vi.fn(() => "trace-1"),
  extensionFromName: vi.fn((name: string) => {
    const match = String(name || "").match(/\.([a-zA-Z0-9]{1,16})$/);
    return match?.[1]?.toLowerCase() || "bin";
  }),
  normalizeMediaUploadMode: vi.fn((value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "blob" || normalized === "s3" || normalized === "dbblob") return normalized;
    return "auto";
  }),
  safeMediaSegment: vi.fn((value: string) => String(value || "").trim() || "file"),
  requireMediaUploadAccess: requireMediaUploadAccessMock,
  resolveMediaUploadTransport: resolveMediaUploadTransportMock,
  upsertMediaRecord: upsertMediaRecordMock,
}));

import { POST } from "@/app/api/media/upload/route";

function makeRequest(formData: FormData, query = "") {
  return new Request(`http://localhost/api/media/upload${query}`, {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/media/upload", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    requireMediaUploadAccessMock.mockReset();
    resolveMediaUploadTransportMock.mockReset();
    upsertMediaRecordMock.mockReset();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    requireMediaUploadAccessMock.mockResolvedValue({ id: "site-1" });
    resolveMediaUploadTransportMock.mockResolvedValue({
      url: "https://blob.example/file.png",
      provider: "blob",
      bucket: "vercel_blob",
    });
    upsertMediaRecordMock.mockResolvedValue({
      id: 42,
      url: "https://blob.example/file.png",
      mimeType: "image/png",
      label: "heroImage",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));

    const response = await POST(makeRequest(formData));

    expect(response.status).toBe(401);
  });

  it("returns 400 for missing file or siteId", async () => {
    const formData = new FormData();
    const response = await POST(makeRequest(formData));

    expect(response.status).toBe(400);
  });

  it("uses the requested provider override and writes the media index", async () => {
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));

    const response = await POST(makeRequest(formData, "?provider=s3"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(resolveMediaUploadTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "s3",
        key: expect.stringContaining("imports/"),
      }),
    );
    expect(upsertMediaRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "site-1",
        userId: "user-1",
        provider: "blob",
      }),
    );
    expect(json.provider).toBe("blob");
    expect(json.url).toBe("https://blob.example/file.png");
    expect(json.mediaId).toBe("42");
  });
});
