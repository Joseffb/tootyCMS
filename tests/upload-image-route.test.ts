import { beforeEach, describe, expect, it, vi } from "vitest";

const { putMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: putMock,
}));

vi.mock("@/lib/media-variants", () => ({
  buildMediaVariants: vi.fn(async (file: File) => ({
    hash: "deadbeefdeadbeef",
    extension:
      file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "bin",
    mimeType: file.type || "application/octet-stream",
    variants: [
      {
        suffix: "original",
        width: null,
        mimeType: file.type || "application/octet-stream",
        buffer: new Uint8Array([1, 2, 3]),
      },
      {
        suffix: "sm",
        width: 480,
        mimeType: file.type || "application/octet-stream",
        buffer: new Uint8Array([1, 2, 3]),
      },
    ],
  })),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/lib/authorization", () => ({
  userCan: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: {
        findFirst: vi.fn(async () => ({ id: "site-1" })),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => undefined),
      })),
    })),
  },
}));

import { POST } from "@/app/api/uploadImage/route";

function makeRequest(formData: FormData) {
  return new Request("http://localhost/api/uploadImage", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/uploadImage", () => {
  beforeEach(() => {
    putMock.mockReset();
    process.env.BLOB_READ_WRITE_TOKEN = "token";
  });

  it("returns 400 when blob token is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("returns 400 for missing fields", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(400);
  });

  it("returns 400 when file is missing", async () => {
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(400);
  });

  it("returns 400 for non-image uploads", async () => {
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("image");
  });

  it("returns 400 for files larger than 50MB", async () => {
    const oversizedBytes = new Uint8Array(50 * 1024 * 1024 + 1);
    const file = new File([oversizedBytes], "oversized.png", {
      type: "image/png",
    });

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append("file", file);

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("50MB");
  });

  it("uploads to Vercel Blob and returns URL", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/asset.png" });

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "Hero Image");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.url).toBe("https://blob.example/asset.png");
    expect(json.hash).toBe("deadbeefdeadbeef");
    expect(json.filename).toBe("site-1/deadbeefdeadbeef.png");
    expect(Array.isArray(json.variants)).toBe(true);
    expect(json.variants).toEqual([
      {
        suffix: "sm",
        width: 480,
        key: "site-1/deadbeefdeadbeef-sm.png",
        url: "https://blob.example/asset.png",
      },
    ]);
    expect(putMock).toHaveBeenCalledTimes(2);
    expect(putMock.mock.calls[0]?.[0]).toBe("site-1/deadbeefdeadbeef.png");
    expect(putMock.mock.calls[1]?.[0]).toBe("site-1/deadbeefdeadbeef-sm.png");
  });

  it("normalizes empty segments and resolves extension from MIME type", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/asset.png" });

    const formData = new FormData();
    formData.append("siteId", "   ");
    formData.append("name", "@@@");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(200);
    expect(putMock.mock.calls[0]?.[0]).toBe("file/deadbeefdeadbeef.png");
    expect(putMock.mock.calls[1]?.[0]).toBe("file/deadbeefdeadbeef-sm.png");
  });

  it("falls back to .bin when extension cannot be resolved", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/asset.bin" });

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover", { type: "image/" }),
    );

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(200);
    expect(putMock.mock.calls[0]?.[0]).toBe("site-1/deadbeefdeadbeef.bin");
    expect(putMock.mock.calls[1]?.[0]).toBe("site-1/deadbeefdeadbeef-sm.bin");
  });

  it("returns 500 when the upload provider throws", async () => {
    putMock.mockRejectedValue(new Error("blob failure"));

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toContain("Upload failed");
  });
});
