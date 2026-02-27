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

  it("tries blob upload first and returns url when successful", async () => {
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
      "/api/uploadImage",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("falls back to local upload when blob upload fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("blob failed", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "/uploads/site-1/image.png" }), {
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

    expect(response.url).toBe("/uploads/site-1/image.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/uploadImage");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/uploadImageLocal");
  });

  it("throws when both upload backends fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("blob failed", { status: 500 }))
      .mockResolvedValueOnce(new Response("local failed", { status: 500 }))
      .mockResolvedValueOnce(new Response("db failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadSmart({
        file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
        name: "heroImage",
        siteId: "site-1",
      }),
    ).rejects.toThrow("/api/uploadImageDb failed (500)");
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/uploadImageDb");
  });

  it("uses blob endpoint only when mode is blob", async () => {
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/uploadImage");
  });

  it("uses local endpoint only when mode is s3", async () => {
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/uploadImageLocal");
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
