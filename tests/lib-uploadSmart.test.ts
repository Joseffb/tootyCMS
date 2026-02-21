import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadSmart } from "@/lib/uploadSmart";

describe("uploadSmart", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
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
      .mockResolvedValueOnce(new Response("local failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadSmart({
        file: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
        name: "heroImage",
        siteId: "site-1",
      }),
    ).rejects.toThrow("Local image upload failed");
  });
});
