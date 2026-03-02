import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  userCanMock,
  createMediaUploadTraceIdMock,
  deleteMediaRecordMock,
  deleteMediaTransportObjectMock,
  getMediaRecordByIdMock,
  updateMediaRecordMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  userCanMock: vi.fn(),
  createMediaUploadTraceIdMock: vi.fn(() => "trace-1"),
  deleteMediaRecordMock: vi.fn(),
  deleteMediaTransportObjectMock: vi.fn(),
  getMediaRecordByIdMock: vi.fn(),
  updateMediaRecordMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/authorization", () => ({
  userCan: userCanMock,
}));

vi.mock("@/lib/media-service", () => ({
  createMediaUploadTraceId: createMediaUploadTraceIdMock,
  deleteMediaRecord: deleteMediaRecordMock,
  deleteMediaTransportObject: deleteMediaTransportObjectMock,
  getMediaRecordById: getMediaRecordByIdMock,
  updateMediaRecord: updateMediaRecordMock,
}));

vi.mock("@/lib/debug", () => ({
  trace: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/media/[id]/route";

describe("/api/media/[id]", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    userCanMock.mockReset();
    createMediaUploadTraceIdMock.mockClear();
    deleteMediaRecordMock.mockReset();
    deleteMediaTransportObjectMock.mockReset();
    getMediaRecordByIdMock.mockReset();
    updateMediaRecordMock.mockReset();

    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    getMediaRecordByIdMock.mockResolvedValue({
      id: 42,
      siteId: "site-1",
      userId: "user-1",
      provider: "s3",
      bucket: "bucket-1",
      objectKey: "site-1/file.png",
      url: "https://cdn.example/file.png",
      label: "file",
      altText: "alt",
      caption: "caption",
      description: "desc",
      mimeType: "image/png",
      size: 123,
    });
    userCanMock.mockResolvedValue(false);
    updateMediaRecordMock.mockResolvedValue({
      id: 42,
      siteId: "site-1",
      userId: "user-1",
      provider: "s3",
      bucket: "bucket-1",
      objectKey: "site-1/file.png",
      url: "https://cdn.example/file.png",
      label: "renamed",
      altText: "updated alt",
      caption: "updated caption",
      description: "updated",
      mimeType: "image/png",
      size: 123,
    });
  });

  it("returns 401 on patch when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/media/42", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: "site-1", label: "x" }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(401);
  });

  it("updates label, alt text, caption, and description when own-edit is allowed", async () => {
    userCanMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const response = await PATCH(
      new Request("http://localhost/api/media/42", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: "site-1",
          label: "renamed",
          altText: "updated alt",
          caption: "updated caption",
          description: "updated",
        }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateMediaRecordMock).toHaveBeenCalledWith({
      id: 42,
      siteId: "site-1",
      label: "renamed",
      altText: "updated alt",
      caption: "updated caption",
      description: "updated",
    });
    expect(json.item.label).toBe("renamed");
    expect(json.item.altText).toBe("updated alt");
    expect(json.item.caption).toBe("updated caption");
    expect(json.item.description).toBe("updated");
  });

  it("rejects delete without typed confirmation", async () => {
    userCanMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const response = await DELETE(
      new Request("http://localhost/api/media/42", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: "site-1", confirm: "nope" }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response.status).toBe(400);
    expect(deleteMediaTransportObjectMock).not.toHaveBeenCalled();
    expect(deleteMediaRecordMock).not.toHaveBeenCalled();
  });

  it("deletes media when confirmation and capability checks pass", async () => {
    userCanMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const response = await DELETE(
      new Request("http://localhost/api/media/42", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: "site-1", confirm: "delete" }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(deleteMediaTransportObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "s3",
        bucket: "bucket-1",
        objectKey: "site-1/file.png",
      }),
    );
    expect(deleteMediaRecordMock).toHaveBeenCalledWith({ id: 42, siteId: "site-1" });
    expect(json.success).toBe(true);
  });
});
