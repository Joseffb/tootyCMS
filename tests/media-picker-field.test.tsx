// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import MediaPickerField from "@/components/media/media-picker-field";

describe("MediaPickerField", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("stores the selected media id in a hidden input", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 27,
            url: "https://cdn.example.com/slide.png",
            objectKey: "site-a/slide.png",
            label: "Slide",
            mimeType: "image/png",
            size: 100,
            provider: "blob",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MediaPickerField siteId="site-a" name="media_id" label="Media Manager" />);

    fireEvent.click(screen.getByRole("button", { name: "Open Media Manager" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /slide/i }));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));

    const input = document.querySelector('input[name="media_id"]') as HTMLInputElement | null;
    expect(input?.value).toBe("27");
  });

  it("can store the selected media URL while preserving a companion media id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 31,
            url: "https://cdn.example.com/hero.png",
            objectKey: "site-a/hero.png",
            label: "Hero",
            mimeType: "image/png",
            size: 120,
            provider: "s3",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MediaPickerField
        siteId="site-a"
        name="hero_image"
        label="Hero Image"
        valueMode="url"
        companionMediaIdName="hero_image__mediaId"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Media Manager" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /hero/i }));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));

    const urlInput = document.querySelector('input[name="hero_image"]') as HTMLInputElement | null;
    const idInput = document.querySelector('input[name="hero_image__mediaId"]') as HTMLInputElement | null;
    expect(urlInput?.value).toBe("https://cdn.example.com/hero.png");
    expect(idInput?.value).toBe("31");
  });

  it("can clear an existing selection", () => {
    render(
      <MediaPickerField
        siteId="site-a"
        name="hero_image"
        label="Hero Image"
        initialValue="https://cdn.example.com/hero.png"
        initialMediaId="31"
        valueMode="url"
        companionMediaIdName="hero_image__mediaId"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Selection" }));

    const urlInput = document.querySelector('input[name="hero_image"]') as HTMLInputElement | null;
    const idInput = document.querySelector('input[name="hero_image__mediaId"]') as HTMLInputElement | null;
    expect(urlInput?.value).toBe("");
    expect(idInput?.value).toBe("");
  });
});
