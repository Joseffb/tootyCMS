import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findSiteMock,
  selectWhereMock,
  insertMock,
  valuesMock,
  onConflictDoUpdateMock,
  assertSiteMediaQuotaAvailableMock,
} = vi.hoisted(() => ({
  findSiteMock: vi.fn(async () => ({ id: "site-1" })),
  selectWhereMock: vi.fn(async () => []),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  onConflictDoUpdateMock: vi.fn(async () => undefined),
  assertSiteMediaQuotaAvailableMock: vi.fn(async () => ({
    allowed: true,
    maxItems: 0,
    currentItems: 0,
  })),
}));

vi.mock("@/lib/media-variants", () => ({
  buildMediaVariants: vi.fn(async (file: File) => ({
    hash: "cafebabecafebabe",
    extension: file.type === "image/png" ? "png" : "bin",
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
        buffer: new Uint8Array([4, 5, 6]),
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

vi.mock("@/lib/media-governance", () => ({
  assertSiteMediaQuotaAvailable: assertSiteMediaQuotaAvailableMock,
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
    insert: insertMock,
  },
}));

insertMock.mockImplementation(() => ({
  values: valuesMock,
}));
valuesMock.mockImplementation(() => ({
  onConflictDoUpdate: onConflictDoUpdateMock,
}));

import { POST } from "@/app/api/uploadImageDb/route";

function makeRequest(formData: FormData) {
  return new Request("http://localhost/api/uploadImageDb", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/uploadImageDb", () => {
  beforeEach(() => {
    findSiteMock.mockClear();
    selectWhereMock.mockClear();
    insertMock.mockClear();
    valuesMock.mockClear();
    onConflictDoUpdateMock.mockClear();
    assertSiteMediaQuotaAvailableMock.mockReset();
    assertSiteMediaQuotaAvailableMock.mockResolvedValue({
      allowed: true,
      maxItems: 0,
      currentItems: 0,
    });
  });

  it("returns 400 for non-image uploads", async () => {
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }));

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("image");
  });

  it("returns 400 for files larger than 5MB in db mode", async () => {
    const oversizedBytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append("file", new File([oversizedBytes], "oversized.png", { type: "image/png" }));

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("5MB");
  });

  it("stores original and variant records and returns variant metadata", async () => {
    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "Hero Image");
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.filename).toBe("site-1/cafebabecafebabe.png");
    expect(json.hash).toBe("cafebabecafebabe");
    expect(json.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(json.variants).toEqual([
      {
        suffix: "sm",
        width: 480,
        key: "site-1/cafebabecafebabe-sm.png",
        url: expect.stringMatching(/^data:image\/png;base64,/),
      },
    ]);
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("returns 429 when media quota is exceeded", async () => {
    assertSiteMediaQuotaAvailableMock.mockResolvedValue({
      allowed: false,
      maxItems: 1,
      currentItems: 1,
    });

    const formData = new FormData();
    formData.append("siteId", "site-1");
    formData.append("name", "heroImage");
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));

    const response = await POST(makeRequest(formData));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.code).toBe("media_quota_exceeded");
    expect(insertMock).not.toHaveBeenCalled();
  });
});
