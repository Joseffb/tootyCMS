// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import MediaManagerModal from "@/components/media/media-manager-modal";

describe("MediaManagerModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens in pick mode without looping when no selectedIds are provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 11,
            url: "https://cdn.example.com/profile.png",
            objectKey: "site-a/profile.png",
            label: "Profile",
            altText: null,
            caption: null,
            description: null,
            mimeType: "image/png",
            size: 100,
            provider: "blob",
            userId: "user-1",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MediaManagerModal
        open
        onClose={() => undefined}
        siteId="site-a"
        mode="pick"
        title="Media Manager"
        onSelect={() => undefined}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
