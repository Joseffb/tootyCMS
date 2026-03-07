// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/media/use-media-picker", () => ({
  useMediaPicker: () => ({
    openMediaPicker: vi.fn(),
    closeMediaPicker: vi.fn(),
    mediaPickerElement: null,
    isMediaPickerOpen: false,
  }),
}));

vi.mock("@/lib/uploadSmart", () => ({
  uploadSmart: vi.fn(),
}));

import ProfileImageField from "@/components/settings/profile-image-field";

describe("profile image field", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an empty circular holder when no explicit profile image exists", () => {
    render(<ProfileImageField siteId="site-1" initialValue="" displayName="Admin User" />);

    expect(screen.getByTestId("profile-image-preview")).toBeTruthy();
    expect(screen.getByTestId("profile-image-empty-state")).toBeTruthy();
    expect(screen.queryByTestId("profile-image-preview-image")).toBeNull();
  });

  it("renders the selected image when a profile image is already set", () => {
    render(
      <ProfileImageField
        siteId="site-1"
        initialValue="https://cdn.example.com/profile.png"
        displayName="Admin User"
      />,
    );

    const image = screen.getByTestId("profile-image-preview-image");
    expect(image).toHaveAttribute("src", "https://cdn.example.com/profile.png");
    expect(screen.queryByTestId("profile-image-empty-state")).toBeNull();
  });
});
