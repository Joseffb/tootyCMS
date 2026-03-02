import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadSmart } from "@/lib/uploadSmart";

describe("uploadSmart", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the canonical media upload endpoint and returns url when successful", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://blob.example/image.png" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await uploadSmart({
      file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      name: "heroImage",
      siteId: "site-1",
    });

    expect(response.url).toBe("https://blob.example/image.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the canonical media upload endpoint fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("upload failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadSmart({
        file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
        name: "heroImage",
        siteId: "site-1",
      }),
    ).rejects.toThrow("/api/media/upload failed (500)");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/media/upload");
  });

  it("uses db blob endpoint when mode is dbblob", async () => {
    process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER = "dbblob";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "data:image/png;base64,abc123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await uploadSmart({
      file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      name: "heroImage",
      siteId: "site-1",
    });

    expect(response.url).toContain("data:image/png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/media/upload?provider=dbblob");
  });

  it("uses canonical media upload with blob provider override when mode is blob", async () => {
    process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER = "blob";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://blob.example/image.png" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadSmart({
      file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      name: "heroImage",
      siteId: "site-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/media/upload?provider=blob");
  });

  it("uses canonical media upload with s3 provider override when mode is s3", async () => {
    process.env.NEXT_PUBLIC_MEDIA_UPLOAD_PROVIDER = "s3";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "/uploads/site-1/image.png" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadSmart({
      file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      name: "heroImage",
      siteId: "site-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/media/upload?provider=s3");
  });

  it("falls back to non-crypto traceId generation when crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://blob.example/image.png" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadSmart({
      file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      name: "heroImage",
      siteId: "site-1",
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["x-trace-id"]).toBeTruthy();
  });
});
