import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureSiteMediaTable = vi.fn();
const getSiteMediaTable = vi.fn();
const isMissingSiteMediaRelationError = vi.fn();
const resetSiteMediaTableCache = vi.fn();

const returning = vi.fn();
const onConflictDoUpdate = vi.fn(() => ({ returning }));
const values = vi.fn(() => ({ onConflictDoUpdate }));
const insert = vi.fn(() => ({ values }));

vi.mock("@/lib/site-media-tables", () => ({
  ensureSiteMediaTable,
  getSiteMediaTable,
  isMissingSiteMediaRelationError,
  resetSiteMediaTableCache,
}));

vi.mock("@/lib/db", () => ({
  default: {
    insert,
    select: vi.fn(() => ({ from: vi.fn(() => []) })),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("media service recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureSiteMediaTable.mockReset();
    getSiteMediaTable.mockReset();
    isMissingSiteMediaRelationError.mockReset();
    resetSiteMediaTableCache.mockReset();
    returning.mockReset();
    onConflictDoUpdate.mockClear();
    values.mockClear();
    insert.mockClear();
  });

  it("re-ensures the site media table and retries once when the media sequence is missing", async () => {
    const mediaTable = {
      id: { name: "id" },
      url: { name: "url" },
      mimeType: { name: "mimeType" },
      label: { name: "label" },
      objectKey: { name: "objectKey" },
    };
    getSiteMediaTable.mockReturnValue(mediaTable);
    isMissingSiteMediaRelationError.mockReturnValue(true);

    const missingSequenceError = Object.assign(
      new Error('relation "tooty_site_test_media_id_seq" does not exist'),
      { code: "42P01" },
    );
    returning
      .mockRejectedValueOnce(missingSequenceError)
      .mockResolvedValueOnce([{ id: 7, url: "https://example.com/file.png", mimeType: "image/png", label: "file" }]);

    const { upsertMediaRecord } = await import("@/lib/media-service");

    const result = await upsertMediaRecord({
      siteId: "site-test",
      userId: "user-1",
      provider: "blob",
      bucket: "vercel_blob",
      objectKey: "media/file.png",
      url: "https://example.com/file.png",
      label: "file",
      mimeType: "image/png",
      size: 123,
    });

    expect(result).toEqual({
      id: 7,
      url: "https://example.com/file.png",
      mimeType: "image/png",
      label: "file",
    });
    expect(ensureSiteMediaTable).toHaveBeenCalledTimes(2);
    expect(ensureSiteMediaTable).toHaveBeenNthCalledWith(1, "site-test");
    expect(ensureSiteMediaTable).toHaveBeenNthCalledWith(2, "site-test");
    expect(resetSiteMediaTableCache).toHaveBeenCalledWith("site-test");
    expect(returning).toHaveBeenCalledTimes(2);
  });
});
