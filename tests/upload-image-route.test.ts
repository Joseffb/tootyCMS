import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  putMock,
  findSiteMock,
  selectWhereMock,
  getSessionMock,
  userCanMock,
  evaluateBotIdRouteMock,
  buildMediaVariantsMock,
} = vi.hoisted(() => ({
  putMock: vi.fn(),
  findSiteMock: vi.fn(async () => ({ id: "site-1" })),
  selectWhereMock: vi.fn(async () => []),
  getSessionMock: vi.fn(async () => ({ user: { id: "user-1" } })),
  userCanMock: vi.fn(async () => true),
  evaluateBotIdRouteMock: vi.fn(async () => ({ allowed: true })),
  buildMediaVariantsMock: vi.fn(async (file: File) => ({
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

vi.mock("@vercel/blob", () => ({
  put: putMock,
}));

vi.mock("@/lib/media-variants", () => ({
  buildMediaVariants: buildMediaVariantsMock,
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: userCanMock,
}));

const { assertSiteMediaQuotaAvailableMock } = vi.hoisted(() => ({
  assertSiteMediaQuotaAvailableMock: vi.fn(async () => ({
    allowed: true,
    maxItems: 0,
    currentItems: 0,
  })),
}));

vi.mock("@/lib/media-governance", () => ({
  assertSiteMediaQuotaAvailable: assertSiteMediaQuotaAvailableMock,
}));

vi.mock("@/lib/botid", () => ({
  evaluateBotIdRoute: evaluateBotIdRouteMock,
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: {
      sites: {
        findFirst: findSiteMock,
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectWhereMock,
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
    findSiteMock.mockReset();
    selectWhereMock.mockReset();
    getSessionMock.mockReset();
    userCanMock.mockReset();
    evaluateBotIdRouteMock.mockReset();
    buildMediaVariantsMock.mockReset();
    findSiteMock.mockResolvedValue({ id: "site-1" });
    selectWhereMock.mockResolvedValue([]);
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    userCanMock.mockResolvedValue(true);
    evaluateBotIdRouteMock.mockResolvedValue({ allowed: true });
    buildMediaVariantsMock.mockImplementation(async (file: File) => ({
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
    }));
    assertSiteMediaQuotaAvailableMock.mockClear();
    assertSiteMediaQuotaAvailableMock.mockResolvedValue({
      allowed: true,
      maxItems: 0,
      currentItems: 0,
    });
    delete process.env.NO_IMAGE_MODE;
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

  it("returns 429 when site media quota is exceeded", async () => {
    assertSiteMediaQuotaAvailableMock.mockResolvedValue({
      allowed: false,
      maxItems: 1,
      currentItems: 1,
    });

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.code).toBe("media_quota_exceeded");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("returns 403 when BotID blocks request", async () => {
    evaluateBotIdRouteMock.mockResolvedValue({ allowed: false });
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(403);
  });

  it("returns 400 when NO_IMAGE_MODE is enabled", async () => {
    process.env.NO_IMAGE_MODE = "true";
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(400);
  });

  it("returns 404 when site does not exist", async () => {
    findSiteMock.mockResolvedValue(null);
    const formData = new FormData();
    formData.append("siteId", "site-404");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Site not found");
  });

  it("returns 401 when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(401);
  });

  it("returns 401 when session lookup throws", async () => {
    getSessionMock.mockRejectedValue(new Error("session failure"));
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(401);
  });

  it("returns 403 when user lacks media.create capability for site", async () => {
    userCanMock.mockResolvedValue(false);
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe("Forbidden");
  });

  it("continues upload when existing media lookup fails", async () => {
    selectWhereMock.mockRejectedValueOnce(new Error("lookup failed"));
    putMock.mockResolvedValue({ url: "https://blob.example/asset.png" });
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.url).toBe("https://blob.example/asset.png");
    expect(putMock).toHaveBeenCalledTimes(2);
  });

  it("reuses existing media keys without uploading duplicates", async () => {
    selectWhereMock.mockResolvedValue([
      {
        objectKey: "site-1/deadbeefdeadbeef.png",
        url: "https://blob.example/original.png",
      },
      {
        objectKey: "site-1/deadbeefdeadbeef-sm.png",
        url: "https://blob.example/sm.png",
      },
    ]);
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.url).toBe("https://blob.example/original.png");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("uses empty original url fallback when no original variant exists", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/sm.png" });
    buildMediaVariantsMock.mockResolvedValue({
      hash: "deadbeefdeadbeef",
      extension: "png",
      mimeType: "image/png",
      variants: [
        {
          suffix: "sm",
          width: 480,
          mimeType: "image/png",
          buffer: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.url).toBe("");
  });

  it("handles non-Error throw types and still returns 500", async () => {
    putMock.mockRejectedValue("boom");
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(500);
  });

  it("continues when session user id becomes undefined after capability check", async () => {
    const sharedSession: { user: { id: string | undefined } } = { user: { id: "user-1" } };
    getSessionMock.mockResolvedValue(sharedSession);
    userCanMock.mockImplementation(async () => {
      sharedSession.user.id = undefined;
      return true;
    });
    putMock.mockResolvedValue({ url: "https://blob.example/asset.png" });
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    const response = await POST(makeRequest(formData));
    expect(response.status).toBe(200);
  });
});
